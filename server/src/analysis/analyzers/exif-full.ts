import type Database from "better-sqlite3";
import pLimit from "p-limit";
import { ExifRepo } from "../../exif/exif-repo.js";
import { EXIF_PROMOTE_VERSION } from "../../exif/promote.js";
import { readTags, isExifToolAvailable, getExifToolVersion } from "../../media/exiftool-client.js";
import type { Analyzer, AnalysisMediaRow, AnalyzerOutcome } from "../types.js";

export const EXIF_FULL_KEY = "exif_full";

// Backfill/re-run path for media_exif. The scan path writes media_exif
// inline (processMediaItem already holds the Tags) and calls markDone, so
// this analyzer only ever sees media indexed before the feature existed or
// rows re-queued by a version bump.
export function createExifFullAnalyzer(db: Database.Database): Analyzer {
  const repo = new ExifRepo(db);
  const limit = pLimit(2); // matches the ExifTool process pool (maxProcs: 2)
  return {
    key: EXIF_FULL_KEY,
    version: EXIF_PROMOTE_VERSION,
    batchSize: 20,
    appliesTo: "1=1",
    async run(rows: AnalysisMediaRow[]): Promise<AnalyzerOutcome[]> {
      if (!isExifToolAvailable()) {
        return rows.map((r) => ({ mediaId: r.id, status: "unsupported" as const, error: "ExifTool not available" }));
      }
      return Promise.all(
        rows.map((row) =>
          limit(async (): Promise<AnalyzerOutcome> => {
            try {
              const tags = await readTags(row.absolute_path);
              repo.upsertFromTags(row.id, tags, getExifToolVersion());
              return { mediaId: row.id, status: "done" };
            } catch (err) {
              return { mediaId: row.id, status: "failed", error: err instanceof Error ? err.message : String(err) };
            }
          }),
        ),
      );
    },
  };
}
