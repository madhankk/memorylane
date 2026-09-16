import { describe, expect, it } from "vitest";
import { previewSequence } from "./useHoverPreview";

describe("folder hover preview sequence", () => {
  it("does not cycle a nested-folder fallback cover and deduplicates direct thumbnails", () => {
    expect(previewSequence({ id: 2, thumbnailVersion: 1 }, [
      { id: 3, thumbnailVersion: 4 },
      { id: 3, thumbnailVersion: 4 },
      { id: 4, thumbnailVersion: 2 },
    ])).toEqual([
      { id: 3, thumbnailVersion: 4 },
      { id: 4, thumbnailVersion: 2 },
    ]);
  });
});
