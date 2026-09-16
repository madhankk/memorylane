import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb } from "../helpers/db.js";
import { upsertAppleAsset, syncAppleRoot, type AppleCatalogAsset } from "../../src/plugins/apple-photos/sync.js";

const baseAsset: AppleCatalogAsset = {
  uuid: "asset-1", original_filename: "Beach.JPG", original_path: null, derivative_path: null,
  original_available: false, date: "2020-06-01T12:00:00", title: "Beach", description: null,
  keywords: ["holiday"], favorite: true, hidden: false, in_trash: false,
  latitude: 10, longitude: 20, faces: [],
};

describe("Apple catalogue media mapping", () => {
  it("keeps one stable row as a preview-only asset gains a local original", async () => {
    const db = await createTestDb();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "memorylane-apple-sync-"));
    const library = path.join(scratch, "Test.photoslibrary");
    const preview = path.join(library, "resources", "derivatives", "preview.jpg");
    const original = path.join(library, "originals", "asset-1.jpg");
    fs.mkdirSync(path.dirname(preview), { recursive: true });
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.writeFileSync(preview, "preview");
    const rootId = Number(db.prepare("INSERT INTO scan_roots (path, enabled, kind) VALUES (?, 1, 'apple-photos')").run(library).lastInsertRowid);
    try {
      const first = upsertAppleAsset(db, rootId, { ...baseAsset, derivative_path: preview });
      expect(first.mediaId).toBeGreaterThan(0);
      expect(first.changed).toBe(true);
      db.prepare("UPDATE media SET thumbnail_status = 'done' WHERE id = ?").run(first.mediaId);
      const again = upsertAppleAsset(db, rootId, { ...baseAsset, derivative_path: preview });
      expect(again).toEqual({ mediaId: first.mediaId, changed: false });
      fs.writeFileSync(original, "original-content");
      const upgraded = upsertAppleAsset(db, rootId, { ...baseAsset, original_path: original, original_available: true, derivative_path: preview });
      expect(upgraded).toEqual({ mediaId: first.mediaId, changed: true });
      expect(db.prepare("SELECT absolute_path, filename, original_available, source_kind, captured_date, gps_lat FROM media WHERE id = ?").get(first.mediaId)).toMatchObject({
        absolute_path: fs.realpathSync(original), filename: "Beach.JPG", original_available: 1, source_kind: "apple-photos", captured_date: "2020-06-01T12:00:00", gps_lat: 10,
      });
      expect((db.prepare("SELECT COUNT(*) AS c FROM media").get() as { c: number }).c).toBe(1);
      expect(db.prepare("SELECT derivative_path, keywords_json FROM apple_photos_assets WHERE media_id = ?").get(first.mediaId)).toEqual({
        derivative_path: fs.realpathSync(preview), keywords_json: '["holiday"]',
      });
    } finally {
      db.close();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("retains unavailable provenance without inventing a media row", async () => {
    const db = await createTestDb();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "memorylane-apple-unavailable-"));
    const library = path.join(scratch, "Test.photoslibrary");
    fs.mkdirSync(library);
    const rootId = Number(db.prepare("INSERT INTO scan_roots (path, enabled, kind) VALUES (?, 1, 'apple-photos')").run(library).lastInsertRowid);
    try {
      expect(upsertAppleAsset(db, rootId, baseAsset)).toEqual({ mediaId: null, changed: false });
      expect((db.prepare("SELECT COUNT(*) AS c FROM media").get() as { c: number }).c).toBe(0);
      expect(db.prepare("SELECT uuid FROM apple_photos_assets WHERE scan_root_id = ?").get(rootId)).toEqual({ uuid: "asset-1" });
    } finally {
      db.close();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("stops at an asset boundary when the plugin is disabled mid-sync", async () => {
    const db = await createTestDb();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "memorylane-apple-cancel-"));
    const library = path.join(scratch, "Test.photoslibrary");
    fs.mkdirSync(library);
    const rootId = Number(db.prepare("INSERT INTO scan_roots (path, enabled, kind) VALUES (?, 1, 'apple-photos')").run(library).lastInsertRowid);
    let enabled = true;
    try {
      const result = await syncAppleRoot(db, rootId,
        async () => ({ assets: [baseAsset, { ...baseAsset, uuid: "asset-2" }], next_cursor: null, total: 2 }),
        () => enabled,
        async () => { enabled = false; });
      expect(result).toEqual({ processed: 1, total: 2, cancelled: true });
      expect((db.prepare("SELECT COUNT(*) AS c FROM apple_photos_assets").get() as { c: number }).c).toBe(1);
    } finally {
      db.close();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});
