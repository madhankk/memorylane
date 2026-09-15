import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { AppPaths } from "../config/paths.js";
import type { Analyzer } from "./types.js";
import { createExifFullAnalyzer } from "./analyzers/exif-full.js";
import { createPhashAnalyzer } from "./analyzers/phash.js";

// Registration order is execution order. Phase 1: EXIF; Phase 2: perceptual
// hash for stacks. Later phases append embed_image, faces (design doc §13).
export function createAnalyzers(db: Database.Database, _logger: Logger, paths: AppPaths): Analyzer[] {
  return [createExifFullAnalyzer(db), createPhashAnalyzer(db, paths)];
}
