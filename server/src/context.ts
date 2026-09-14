import type Database from "better-sqlite3";
import type { AppPaths } from "./config/paths.js";
import { SessionStore } from "./auth/sessions.js";
import type { ScannerService } from "./scanner/scanner-service.js";
import type { RandomSelectionService } from "./media/random-selection-service.js";
import type { TranscodeWorker } from "./media/transcode-worker.js";

// Central set of app-wide singletons, built once at startup and passed to every
// route module. Keeps routes free of import-order/singleton-init footguns.
export interface AppContext {
  db: Database.Database;
  paths: AppPaths;
  sessions: SessionStore;
  scanner: ScannerService;
  randomSelection: RandomSelectionService;
  transcodeWorker: TranscodeWorker;
}
