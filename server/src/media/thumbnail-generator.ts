import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const THUMBNAIL_LONG_EDGE = 500;

// A second, larger tier used only for RAW files. Standard JPEGs/PNGs/etc. get
// viewed at full original resolution via /api/media/:id/file - only RAW has
// no browser-viewable original, so without this it would fall back to the
// same 500px grid thumbnail in the fullscreen Viewer, looking soft/small.
// Generated from the same already-extracted embedded preview buffer as the
// grid thumbnail, so it costs one extra Sharp resize, not another ExifTool call.
export const PREVIEW_LONG_EDGE = 1800;

async function ensureDirFor(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

// Resizes from a source file path (standard images) - Sharp handles EXIF
// orientation automatically via .rotate() with no arguments.
export async function generateThumbnailFromFile(sourcePath: string, destPath: string): Promise<void> {
  await ensureDirFor(destPath);
  await sharp(sourcePath)
    .rotate()
    .resize({ width: THUMBNAIL_LONG_EDGE, height: THUMBNAIL_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(destPath);
}

// Resizes from an in-memory buffer (RAW embedded previews extracted via ExifTool).
export async function generateThumbnailFromBuffer(buffer: Buffer, destPath: string): Promise<void> {
  await ensureDirFor(destPath);
  await sharp(buffer)
    .rotate()
    .resize({ width: THUMBNAIL_LONG_EDGE, height: THUMBNAIL_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(destPath);
}

// Larger RAW-only preview for fullscreen viewing - see PREVIEW_LONG_EDGE above.
export async function generatePreviewFromBuffer(buffer: Buffer, destPath: string): Promise<void> {
  await ensureDirFor(destPath);
  await sharp(buffer)
    .rotate()
    .resize({ width: PREVIEW_LONG_EDGE, height: PREVIEW_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(destPath);
}

export async function readImageDimensions(sourcePath: string): Promise<{ width: number | null; height: number | null; orientation: number | null }> {
  try {
    const meta = await sharp(sourcePath).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null, orientation: meta.orientation ?? null };
  } catch {
    return { width: null, height: null, orientation: null };
  }
}
