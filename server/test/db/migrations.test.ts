import { describe, it, expect } from "vitest";
import { createTestDb, seedScanRoot, seedFolder, seedMedia } from "../helpers/db.js";

describe("migrations", () => {
  it("apply cleanly to an in-memory database and seed helpers work", async () => {
    const db = await createTestDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("media");
    expect(names).toContain("media_engagement");
    expect(names).toContain("media_exif");
    expect(names).toContain("media_analysis");
    for (const t of ["media_phash", "stacks", "stack_members", "stack_exclusions", "stack_dirty_folders", "media_embeddings", "persons", "faces", "face_person_rejections"]) expect(names).toContain(t);

    const root = seedScanRoot(db);
    const folder = seedFolder(db, root, "/library/2019");
    const id = seedMedia(db, folder, root);
    expect(db.prepare("SELECT filename FROM media WHERE id = ?").get(id)).toEqual({ filename: "IMG_0001.jpg" });
  });
});
