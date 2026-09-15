import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { Analyzer } from "./types.js";
import { createExifFullAnalyzer } from "./analyzers/exif-full.js";

// Registration order is execution order. Phase 1: EXIF only. Later phases
// append phash, embed_image, faces (design doc §13).
export function createAnalyzers(db: Database.Database, _logger: Logger): Analyzer[] {
  return [createExifFullAnalyzer(db)];
}
