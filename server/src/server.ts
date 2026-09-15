import { resolveAppPaths } from "./config/paths.js";
import { openDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { SettingsRepo } from "./db/settings-repo.js";
import { SessionStore } from "./auth/sessions.js";
import { ScannerService } from "./scanner/scanner-service.js";
import { SqliteRandomSelectionService } from "./media/random-selection-service.js";
import { checkExifToolAvailable, shutdownExifTool } from "./media/exiftool-client.js";
import { checkFfmpegAvailable } from "./media/video-client.js";
import { TranscodeWorker } from "./media/transcode-worker.js";
import { AnalysisWorker } from "./analysis/analysis-worker.js";
import { createAnalyzers } from "./analysis/registry.js";
import { buildApp } from "./app.js";
import type { AppContext } from "./context.js";

async function main(): Promise<void> {
  const paths = resolveAppPaths();
  const db = openDatabase(paths.dbPath);

  // A minimal bootstrap logger for pre-app startup steps (migrations, tool
  // detection) - the full pino instance lives on the Fastify app once built.
  const bootstrapLogger = {
    info: (obj: unknown, msg?: string) => console.log(msg ?? "", obj ?? ""),
    warn: (obj: unknown, msg?: string) => console.warn(msg ?? "", obj ?? ""),
    error: (obj: unknown, msg?: string) => console.error(msg ?? "", obj ?? ""),
  } as unknown as import("pino").Logger;

  await runMigrations(db, paths.dbPath, bootstrapLogger);
  await checkExifToolAvailable(bootstrapLogger);
  await checkFfmpegAvailable(bootstrapLogger);

  const settingsRepo = new SettingsRepo(db);
  const settings = settingsRepo.getAll();

  const sessions = new SessionStore(db);
  sessions.destroyAllExpired();

  const scanner = new ScannerService(db, paths, bootstrapLogger);
  const randomSelection = new SqliteRandomSelectionService(db);
  const transcodeWorker = new TranscodeWorker(db, paths, bootstrapLogger, scanner);

  const analysisWorker = new AnalysisWorker(db, bootstrapLogger, createAnalyzers(db, bootstrapLogger), () => scanner.isRunning());

  const ctx: AppContext = { db, paths, sessions, scanner, randomSelection, transcodeWorker, analysisWorker };
  const app = await buildApp(ctx);

  // Reconcile any video transcode job left mid-flight by a previous process
  // exit (crash, restart) and resume anything that was merely queued - see
  // TranscodeWorker.reconcileAndResume for why those two cases are handled
  // differently.
  transcodeWorker.reconcileAndResume();

  // Background analysis (full EXIF backfill today; embeddings/faces later)
  // trails the scanner: it re-queues anything a scan touched and yields
  // entirely while a scan is running.
  analysisWorker.start();
  scanner.onScanFinished(() => analysisWorker.kick());

  scanner.scheduleFromSettings(settings.scanIntervalDays, settings.scanScheduleEnabled);

  const bindAddress = process.env.MEMORYLANE_BIND_ADDRESS ?? settings.bindAddress;
  const port = Number(process.env.MEMORYLANE_PORT ?? settings.port);

  await app.listen({ host: bindAddress, port });
  app.log.info({ bindAddress, port, dataDir: paths.dataDir }, "MemoryLane server started");

  // 0.0.0.0 (listen on every interface) always includes loopback too, so
  // http://127.0.0.1 is reachable there just as much as an explicit
  // 127.0.0.1/localhost bind - only skip auto-open for some other specific
  // non-loopback interface a user deliberately bound to.
  //
  // Also skip it under `npm run dev`: tsx watch restarts this whole process
  // on every file save, and re-popping a browser tab on every restart during
  // active development is disruptive rather than helpful - npm sets
  // npm_lifecycle_event to the script name for the life of the process tsx
  // watch keeps respawning, so this stays off across every restart in a dev
  // session, not just the first one.
  const isDevWatch = process.env.npm_lifecycle_event === "dev";
  if (
    !process.env.MEMORYLANE_NO_OPEN &&
    !isDevWatch &&
    (bindAddress === "127.0.0.1" || bindAddress === "localhost" || bindAddress === "0.0.0.0")
  ) {
    const url = `http://127.0.0.1:${port}`;
    try {
      const open = (await import("open")).default;
      await open(url);
    } catch (err) {
      app.log.warn({ err }, "Could not automatically open the browser - open it manually");
    }
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    await analysisWorker.stop();
    await app.close();
    await shutdownExifTool();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
