import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { AppPaths } from "../config/paths.js";
import type { SettingsRepo } from "../db/settings-repo.js";
import type { AiProvider } from "../providers/types.js";
import type { VectorIndex } from "../vectors/vector-index.js";
import type { Analyzer } from "./types.js";
import { createExifFullAnalyzer } from "./analyzers/exif-full.js";
import { createPhashAnalyzer } from "./analyzers/phash.js";
import { createEmbedImageAnalyzer } from "./analyzers/embed-image.js";

export interface AnalyzerDeps {
  paths: AppPaths;
  settings: SettingsRepo;
  // null when MEMORYLANE_AI_PROVIDER=none - provider-backed analyzers are then not registered at all.
  provider: AiProvider | null;
  vectorIndex: VectorIndex;
}

// Registration order is execution order. Phase 1: EXIF; Phase 2: perceptual
// hash for stacks; Phase 3: image embeddings via the sidecar. Faces follow.
export function createAnalyzers(db: Database.Database, _logger: Logger, deps: AnalyzerDeps): Analyzer[] {
  const analyzers: Analyzer[] = [createExifFullAnalyzer(db), createPhashAnalyzer(db, deps.paths)];
  if (deps.provider) {
    analyzers.push(createEmbedImageAnalyzer(db, deps.paths, deps.provider, deps.vectorIndex, () => deps.settings.getAll().aiEnabled));
  }
  return analyzers;
}
