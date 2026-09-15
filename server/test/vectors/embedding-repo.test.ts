import { describe, it, expect } from "vitest";
import { createTestDb, seedScanRoot, seedFolder, seedMedia } from "../helpers/db.js";
import { EmbeddingRepo, vectorToBlob, blobToVector } from "../../src/vectors/embedding-repo.js";

describe("EmbeddingRepo", () => {
  it("round-trips float32 vectors through BLOBs", () => {
    const v = Float32Array.from([0.1, -0.5, 1, 0]);
    expect(Array.from(blobToVector(vectorToBlob(v)))).toEqual(Array.from(v));
  });

  it("upserts, counts, iterates in id order and overwrites", async () => {
    const db = await createTestDb();
    const root = seedScanRoot(db);
    const folder = seedFolder(db, root, "/lib");
    const a = seedMedia(db, folder, root), b = seedMedia(db, folder, root);
    const repo = new EmbeddingRepo(db);
    repo.upsertMany("m@1", [{ mediaId: b, vector: Float32Array.from([0, 1]) }, { mediaId: a, vector: Float32Array.from([1, 0]) }]);
    expect(repo.count("m@1")).toBe(2);
    expect(repo.count("other")).toBe(0);
    expect(repo.dim("m@1")).toBe(2);
    expect([...repo.iterate("m@1")].map((r) => r.id)).toEqual([a, b]);
    repo.upsertMany("m@1", [{ mediaId: a, vector: Float32Array.from([0.5, 0.5]) }]);
    expect(Array.from(repo.get(a, "m@1")!)).toEqual([0.5, 0.5]);
    expect(repo.get(a, "other")).toBeNull();
    expect(repo.deleteModel("m@1")).toBe(2);
  });
});
