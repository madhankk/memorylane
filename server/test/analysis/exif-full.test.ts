import { describe, expect, it } from "vitest";
import { createExifFullAnalyzer, classifyExifFailure } from "../../src/analysis/analyzers/exif-full.js";
import { createTestDb } from "../helpers/db.js";

describe("EXIF analyzer failure classification", () => {
  it("skips a zero-byte media row without relying on ExifTool's error wording", async () => {
    const db = await createTestDb();
    const analyzer = createExifFullAnalyzer(db);
    const outcomes = await analyzer.run([
      { id: 1, parent_folder_id: 1, absolute_path: "/missing/empty.jpg", media_type: "image", file_size: 0 },
    ]);
    expect(outcomes).toEqual([{
      mediaId: 1,
      status: "unsupported",
      error: "File is empty",
    }]);
  });

  it("keeps other read errors retryable", () => {
    expect(classifyExifFailure(new Error("Permission denied"))).toEqual({
      status: "failed",
      error: "Permission denied",
    });
  });
});
