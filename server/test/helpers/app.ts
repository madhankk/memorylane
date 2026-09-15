import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createTestDb } from "./db.js";
import { buildApp } from "../../src/app.js";
import type { AppContext } from "../../src/context.js";
import { SessionStore, SESSION_COOKIE_NAME } from "../../src/auth/sessions.js";
import { AnalysisWorker } from "../../src/analysis/analysis-worker.js";
import { SqliteRandomSelectionService } from "../../src/media/random-selection-service.js";
import type { ScannerService } from "../../src/scanner/scanner-service.js";
import type { TranscodeWorker } from "../../src/media/transcode-worker.js";
import type { AppPaths } from "../../src/config/paths.js";
import { StackService } from "../../src/stacks/stack-service.js";
import { SettingsRepo } from "../../src/db/settings-repo.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as import("pino").Logger;

// A fully routed Fastify app over an in-memory DB with one logged-in user.
// Scanner/transcode are inert stubs - route tests never trigger real scans.
export async function createTestApp() {
  process.env.LOG_LEVEL = "silent";
  const db = await createTestDb();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memorylane-test-"));
  const paths: AppPaths = {
    dataDir,
    dbPath: path.join(dataDir, "db.sqlite"),
    thumbnailsDir: path.join(dataDir, "thumbnails"),
    previewsDir: path.join(dataDir, "previews"),
    transcodingDir: path.join(dataDir, "transcoding"),
    logsDir: path.join(dataDir, "logs"),
    clientDistDir: path.join(dataDir, "no-client"),
  };
  const sessions = new SessionStore(db);
  const userId = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('tester', 'x')").run().lastInsertRowid);
  const session = sessions.create(userId);
  const scanner = {
    isRunning: () => false,
    onScanFinished() {},
    getStatus: () => ({ running: false }),
    getHistory: () => [],
  } as unknown as ScannerService;
  const analysisWorker = new AnalysisWorker(db, logger, [], () => false);
  const ctx: AppContext = {
    db,
    paths,
    sessions,
    scanner,
    randomSelection: new SqliteRandomSelectionService(db),
    transcodeWorker: {} as TranscodeWorker,
    analysisWorker,
    stacks: new StackService(db, logger, new SettingsRepo(db)),
  };
  const app: FastifyInstance = await buildApp(ctx);
  return {
    app,
    db,
    ctx,
    cookie: `${SESSION_COOKIE_NAME}=${session.id}`,
    async close() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
