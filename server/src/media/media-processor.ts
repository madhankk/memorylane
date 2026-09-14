import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { Tags } from "exiftool-vendored";
import { thumbnailPathForMediaId, previewPathForMediaId, type AppPaths } from "../config/paths.js";
import { readTags, extractLargestEmbeddedPreview, isExifToolAvailable } from "./exiftool-client.js";
import { probeVideo, extractPosterFrame, isFfmpegAvailable } from "./video-client.js";
import {
  generateThumbnailFromFile,
  generateThumbnailFromBuffer,
  generatePreviewFromBuffer,
  readImageDimensions,
} from "./thumbnail-generator.js";

export interface MediaRowForProcessing {
  id: number;
  parent_folder_id: number;
  absolute_path: string;
  media_type: "image" | "raw" | "video";
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function dateOrNull(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "object" && v !== null && "toISOString" in v) {
    try {
      return (v as { toISOString: () => string }).toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function extractMetadataFields(tags: Tags | null) {
  if (!tags) {
    return {
      capturedDate: null, width: null, height: null, orientation: null,
      cameraMake: null, cameraModel: null, lensModel: null, focalLength: null,
      aperture: null, shutterSpeed: null, iso: null, rating: null,
      gpsLat: null, gpsLon: null, durationSeconds: null, codec: null,
      contentIdentifier: null,
    };
  }
  return {
    capturedDate: dateOrNull(tags.DateTimeOriginal) ?? dateOrNull(tags.CreateDate),
    width: numOrNull(tags.ImageWidth) ?? numOrNull(tags.ExifImageWidth),
    height: numOrNull(tags.ImageHeight) ?? numOrNull(tags.ExifImageHeight),
    orientation: typeof tags.Orientation === "number" ? tags.Orientation : null,
    cameraMake: tags.Make ?? null,
    cameraModel: tags.Model ?? null,
    lensModel: tags.LensModel ?? tags.LensID ?? null,
    focalLength: numOrNull(tags.FocalLength),
    aperture: numOrNull(tags.FNumber),
    shutterSpeed: tags.ShutterSpeed != null ? String(tags.ShutterSpeed) : null,
    iso: numOrNull(tags.ISO),
    rating: numOrNull(tags.Rating),
    gpsLat: numOrNull(tags.GPSLatitude),
    gpsLon: numOrNull(tags.GPSLongitude),
    // Video-specific - left null here and filled in from ffprobe (more
    // reliable for these than ExifTool) in the video branch below.
    durationSeconds: null as number | null,
    codec: null as string | null,
    // Apple Live Photos: the still half and its paired ~3s video share this
    // identifier - used only to find each other during indexing (see
    // linkLivePhotoPair), never exposed to the client.
    contentIdentifier: tags.ContentIdentifier ?? null,
  };
}

// Called after a still photo or video's own metadata is saved, to complete a
// Live Photo pairing in whichever order the two halves happened to be
// scanned in. Best-effort: a missing/unmatched identifier just means this
// isn't a Live Photo (or its other half hasn't been scanned yet, which
// self-heals whenever that half is indexed and runs this same lookup from
// its own side).
function linkLivePhotoPair(
  db: Database.Database,
  mediaId: number,
  parentFolderId: number,
  mediaType: "image" | "raw" | "video",
  contentIdentifier: string | null,
): void {
  if (!contentIdentifier) return;
  if (mediaType === "video") {
    db.prepare(
      `UPDATE media SET live_photo_video_id = ?
       WHERE parent_folder_id = ? AND content_identifier = ? AND media_type IN ('image', 'raw') AND id != ?`,
    ).run(mediaId, parentFolderId, contentIdentifier, mediaId);
  } else {
    const video = db
      .prepare(
        `SELECT id FROM media WHERE parent_folder_id = ? AND content_identifier = ? AND media_type = 'video' AND id != ?`,
      )
      .get(parentFolderId, contentIdentifier, mediaId) as { id: number } | undefined;
    if (video) {
      db.prepare("UPDATE media SET live_photo_video_id = ? WHERE id = ?").run(video.id, mediaId);
    }
  }
}

// Processes one media row end-to-end: metadata extraction + thumbnail
// generation. Never throws - failures are logged and reflected in
// thumbnail_status so a single corrupt file can never abort a scan.
//
// Metadata extraction and thumbnail generation are guarded independently
// (rather than one try/catch around everything) so that a thumbnail failure
// - a corrupt file, an unsupported format quirk - never discards metadata
// ExifTool already successfully read. Losing captured-date/camera/GPS data
// just because Sharp couldn't decode the file would be an unrelated failure
// bundled into one.
export async function processMediaItem(
  db: Database.Database,
  paths: AppPaths,
  logger: Logger,
  row: MediaRowForProcessing,
): Promise<void> {
  const destPath = thumbnailPathForMediaId(paths.thumbnailsDir, row.id);

  let metadata: ReturnType<typeof extractMetadataFields>;
  try {
    metadata = extractMetadataFields(isExifToolAvailable() ? await readTags(row.absolute_path) : null);
  } catch (err) {
    logger.error({ err, mediaId: row.id, path: row.absolute_path }, "Failed to read metadata");
    metadata = extractMetadataFields(null);
  }

  let thumbnailStatus: "done" | "unsupported" | "failed" = "failed";
  try {
    if (row.media_type === "raw") {
      const preview = await extractLargestEmbeddedPreview(row.absolute_path);
      if (preview) {
        // Two tiers from the same extracted buffer (no extra ExifTool call):
        // a small grid thumbnail, and a much larger preview for the fullscreen
        // Viewer, since RAW has no browser-viewable original to fall back on.
        // Orientation comes from the RAW file's own EXIF (metadata.orientation)
        // rather than the embedded preview buffer's - RAW previews frequently
        // lack their own orientation tag, so trusting the buffer leaves
        // portrait photos sideways.
        await generateThumbnailFromBuffer(preview, destPath, metadata.orientation);
        await generatePreviewFromBuffer(
          preview,
          previewPathForMediaId(paths.previewsDir, row.id),
          metadata.orientation,
        );
        thumbnailStatus = "done";
      } else {
        thumbnailStatus = "unsupported";
        logger.warn({ mediaId: row.id, path: row.absolute_path }, "No usable embedded preview found in RAW file");
      }
    } else if (row.media_type === "image") {
      // Fall back to Sharp's own dimension reading if ExifTool wasn't available.
      if (metadata.width === null || metadata.height === null) {
        const dims = await readImageDimensions(row.absolute_path);
        metadata = { ...metadata, width: dims.width, height: dims.height, orientation: metadata.orientation ?? dims.orientation };
      }
      await generateThumbnailFromFile(row.absolute_path, destPath);
      thumbnailStatus = "done";
    } else {
      // Thumbnail (a single poster frame) only - originals are always served
      // as-is for playback, never transcoded. If a browser can't decode a
      // given container/codec it simply won't play, same as any other
      // unsupported format elsewhere in the app - no compatibility layer.
      if (isFfmpegAvailable()) {
        const probe = await probeVideo(row.absolute_path);
        if (probe) {
          metadata = {
            ...metadata,
            width: probe.width ?? metadata.width,
            height: probe.height ?? metadata.height,
            durationSeconds: probe.durationSeconds,
            codec: probe.codec,
          };
        }
        const frame = await extractPosterFrame(row.absolute_path);
        if (frame) {
          await generateThumbnailFromBuffer(frame, destPath, null);
          thumbnailStatus = "done";
        } else {
          thumbnailStatus = "unsupported";
          logger.warn({ mediaId: row.id, path: row.absolute_path }, "Could not extract a poster frame from video");
        }
      } else {
        thumbnailStatus = "unsupported";
      }
    }
  } catch (err) {
    logger.error({ err, mediaId: row.id, path: row.absolute_path }, "Failed to generate thumbnail");
    thumbnailStatus = "failed";
  }

  try {
    db.prepare(
      `UPDATE media SET
        captured_date = ?, width = ?, height = ?, orientation = ?,
        camera_make = ?, camera_model = ?, lens_model = ?, focal_length = ?,
        aperture = ?, shutter_speed = ?, iso = ?, rating = ?, gps_lat = ?, gps_lon = ?,
        duration_seconds = ?, codec = ?, content_identifier = ?,
        thumbnail_status = ?,
        thumbnail_version = thumbnail_version + 1
      WHERE id = ?`,
    ).run(
      metadata.capturedDate, metadata.width, metadata.height, metadata.orientation,
      metadata.cameraMake, metadata.cameraModel, metadata.lensModel, metadata.focalLength,
      metadata.aperture, metadata.shutterSpeed, metadata.iso, metadata.rating, metadata.gpsLat, metadata.gpsLon,
      metadata.durationSeconds, metadata.codec, metadata.contentIdentifier,
      thumbnailStatus, row.id,
    );
    linkLivePhotoPair(db, row.id, row.parent_folder_id, row.media_type, metadata.contentIdentifier);
  } catch (err) {
    logger.error({ err, mediaId: row.id, path: row.absolute_path }, "Failed to save media metadata");
  }
}
