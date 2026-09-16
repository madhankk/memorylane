import { describe, expect, it } from "vitest";
import { createTestDb, seedFolder, seedMedia } from "../helpers/db.js";
import { browseApplePhotos } from "../../src/plugins/apple-photos/browse.js";

describe("Apple Photos virtual browse", () => {
  it("groups catalog-only and indexed assets by adjusted date without creating folders", async () => {
    const db = await createTestDb();
    try {
      const root = Number(db.prepare("INSERT INTO scan_roots (path, enabled, kind) VALUES ('/Test.photoslibrary', 1, 'apple-photos')").run().lastInsertRowid);
      const folder = seedFolder(db, root, "/Test.photoslibrary");
      const mediaId = seedMedia(db, folder, root, { captured_date: "2021-08-11T09:00:00", thumbnail_status: "done" });
      const insert = db.prepare(`INSERT INTO apple_photos_assets
        (scan_root_id, uuid, media_id, original_filename, catalog_date, catalog_gps_lat, catalog_gps_lon, hidden)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      insert.run(root, "indexed", mediaId, "indexed.jpg", "2020-04-01T00:00:00", 1, 2, 0);
      insert.run(root, "cloud", null, "cloud.jpg", "2021-08-12T09:00:00", 3, 4, 0);
      insert.run(root, "unknown", null, "unknown.jpg", null, null, null, 0);
      insert.run(root, "hidden", null, "hidden.jpg", "2021-08-12", 5, 6, 1);
      const years = browseApplePhotos(db, root, null, null, 0, 20);
      expect(years.groups.map((g) => [g.key, g.count])).toEqual([["2021", 2], ["unknown", 1]]);
      const months = browseApplePhotos(db, root, "2021", null, 0, 20);
      expect(months.groups.map((g) => [g.key, g.count])).toEqual([["08", 2]]);
      const photos = browseApplePhotos(db, root, "2021", "08", 0, 20);
      expect(photos.total).toBe(2);
      expect(photos.items.map((i) => i.uuid)).toEqual(["cloud", "indexed"]);
      expect(photos.items[0]).toMatchObject({ available: false, latitude: 3, longitude: 4 });
      expect(photos.items[1]).toMatchObject({ available: true, mediaId });
      expect(browseApplePhotos(db, root, "unknown", null, 0, 20).items.map((i) => i.uuid)).toEqual(["unknown"]);
      expect((db.prepare("SELECT COUNT(*) AS c FROM folders").get() as { c: number }).c).toBe(1);
    } finally { db.close(); }
  });
});
