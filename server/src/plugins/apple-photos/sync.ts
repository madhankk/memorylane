import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { computeFingerprint } from "../../scanner/fingerprint.js";
import { classifyExtension } from "../../scanner/media-types.js";
import { getOrCreateFolder } from "../../scanner/folder-repo.js";

export interface AppleCatalogAsset {
  uuid: string;
  original_filename: string | null;
  original_path: string | null;
  derivative_path: string | null;
  original_available: boolean;
  date: string | null;
  title: string | null;
  description: string | null;
  keywords: string[];
  favorite: boolean;
  hidden: boolean;
  in_trash: boolean;
  latitude: number | null;
  longitude: number | null;
  faces: { name: string; x: number; y: number; w: number; h: number }[];
}

interface RootRow { path: string; kind: string }
interface ExistingAsset { media_id: number | null }
interface ExistingMedia { absolute_path: string; fingerprint: string; thumbnail_status: string }

function availablePath(rootPath: string, candidate: string | null): string | null {
  if (!candidate) return null;
  try {
    const realRoot = fs.realpathSync(rootPath);
    const realCandidate = fs.realpathSync(candidate);
    if (!realCandidate.startsWith(realRoot + path.sep)) return null;
    if (!fs.statSync(realCandidate).isFile()) return null;
    return realCandidate;
  } catch {
    return null;
  }
}

export function upsertAppleAsset(
  db: Database.Database,
  scanRootId: number,
  asset: AppleCatalogAsset,
): { mediaId: number | null; changed: boolean } {
  const root = db.prepare("SELECT path, kind FROM scan_roots WHERE id = ?").get(scanRootId) as RootRow | undefined;
  if (!root || root.kind !== "apple-photos") throw new Error("Apple Photos scan root not found");
  if (!asset.uuid || !asset.original_filename) throw new Error("Invalid Apple Photos asset identity");

  const original = availablePath(root.path, asset.original_path);
  const derivative = availablePath(root.path, asset.derivative_path);
  const chosen = original ?? derivative;
  const existing = db.prepare("SELECT media_id FROM apple_photos_assets WHERE scan_root_id = ? AND uuid = ?")
    .get(scanRootId, asset.uuid) as ExistingAsset | undefined;

  return db.transaction(() => {
    let mediaId = existing?.media_id ?? null;
    let changed = false;
    if (chosen && !asset.hidden && !asset.in_trash) {
      const stat = fs.statSync(chosen);
      const extension = path.extname(chosen).slice(1).toLowerCase();
      const mediaType = classifyExtension(extension);
      if (!mediaType) throw new Error(`Unsupported Apple Photos media type: ${extension}`);
      const fingerprint = computeFingerprint(stat.size, stat.mtimeMs);
      const folder = getOrCreateFolder(db, scanRootId, null, path.basename(root.path), root.path);
      const filename = asset.original_filename;
      if (mediaId === null) {
        const inserted = db.prepare(`INSERT INTO media
          (parent_folder_id, scan_root_id, absolute_path, filename, extension, media_type,
           file_size, fs_created_at, fs_modified_at, fingerprint, thumbnail_status, status,
           source_kind, original_available, captured_date, gps_lat, gps_lon)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'active', 'apple-photos', ?, ?, ?, ?)`)
          .run(folder.id, scanRootId, chosen, filename, extension, mediaType, stat.size,
            stat.birthtime.toISOString(), stat.mtime.toISOString(), fingerprint,
            original ? 1 : 0, asset.date, asset.latitude, asset.longitude);
        mediaId = Number(inserted.lastInsertRowid);
        changed = true;
      } else {
        const prior = db.prepare("SELECT absolute_path, fingerprint, thumbnail_status FROM media WHERE id = ?")
          .get(mediaId) as ExistingMedia | undefined;
        changed = !prior || prior.absolute_path !== chosen || prior.fingerprint !== fingerprint || prior.thumbnail_status !== "done";
        db.prepare(`UPDATE media SET absolute_path = ?, filename = ?, extension = ?, media_type = ?,
          file_size = ?, fs_modified_at = ?, fingerprint = ?, source_kind = 'apple-photos',
          original_available = ?, captured_date = COALESCE(?, captured_date),
          gps_lat = COALESCE(gps_lat, ?), gps_lon = COALESCE(gps_lon, ?),
          thumbnail_status = CASE WHEN ? THEN 'pending' ELSE thumbnail_status END,
          status = 'active', last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
          .run(chosen, filename, extension, mediaType, stat.size, stat.mtime.toISOString(), fingerprint,
            original ? 1 : 0, asset.date, asset.latitude, asset.longitude, changed ? 1 : 0, mediaId);
      }
      if (asset.favorite) {
        db.prepare(`INSERT INTO media_engagement (media_id, favorite, favorited_at) VALUES (?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT(media_id) DO UPDATE SET favorite = 1, favorited_at = COALESCE(media_engagement.favorited_at, excluded.favorited_at)`)
          .run(mediaId);
      }
    } else if (mediaId !== null) {
      db.prepare("UPDATE media SET status = 'missing' WHERE id = ?").run(mediaId);
    }

    db.prepare(`INSERT INTO apple_photos_assets
      (scan_root_id, uuid, media_id, original_filename, original_path, derivative_path,
       title, description, keywords_json, faces_json, favorite, hidden, in_trash, original_available)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_root_id, uuid) DO UPDATE SET
        media_id = excluded.media_id, original_filename = excluded.original_filename,
        original_path = excluded.original_path, derivative_path = excluded.derivative_path,
        title = excluded.title, description = excluded.description,
        keywords_json = excluded.keywords_json, faces_json = excluded.faces_json,
        favorite = excluded.favorite, hidden = excluded.hidden, in_trash = excluded.in_trash,
        original_available = excluded.original_available,
        synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      .run(scanRootId, asset.uuid, mediaId, asset.original_filename, original, derivative,
        asset.title, asset.description, JSON.stringify(asset.keywords), JSON.stringify(asset.faces),
        asset.favorite ? 1 : 0, asset.hidden ? 1 : 0, asset.in_trash ? 1 : 0, original ? 1 : 0);

    return { mediaId, changed };
  })();
}

export interface CatalogPage {
  assets: AppleCatalogAsset[];
  next_cursor: number | null;
  total: number;
}

export async function syncAppleRoot(
  db: Database.Database,
  scanRootId: number,
  fetchPage: (cursor: number) => Promise<CatalogPage>,
  isEnabled: () => boolean,
  onAsset: (result: { mediaId: number | null; changed: boolean }) => Promise<void> = async () => {},
  onProgress: (processed: number, total: number) => void = () => {},
): Promise<{ processed: number; total: number; cancelled: boolean }> {
  let cursor = 0;
  let processed = 0;
  let total = 0;
  while (true) {
    if (!isEnabled()) return { processed, total, cancelled: true };
    const page = await fetchPage(cursor);
    total = page.total;
    for (const asset of page.assets) {
      if (!isEnabled()) return { processed, total, cancelled: true };
      const result = upsertAppleAsset(db, scanRootId, asset);
      processed++;
      onProgress(processed, total);
      await onAsset(result);
    }
    if (page.next_cursor === null) return { processed, total, cancelled: false };
    if (page.next_cursor <= cursor) throw new Error("Apple Photos helper returned a non-advancing cursor");
    cursor = page.next_cursor;
  }
}
