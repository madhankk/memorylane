import { resolveAppPaths } from "./config/paths.js";
import { openDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { SettingsRepo } from "./db/settings-repo.js";
import { SessionStore } from "./auth/sessions.js";
import { ScannerService } from "./scanner/scanner-service.js";
import { SqliteRandomSelectionService } from "./media/random-selection-service.js";
import { checkExifToolAvailable, shutdownExifTool } from "./media/exiftool-client.js";
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

  runMigrations(db, bootstrapLogger);
  await checkExifToolAvailable(bootstrapLogger);

  const settingsRepo = new SettingsRepo(db);
  const settings = settingsRepo.getAll();

  const sessions = new SessionStore(db);
  sessions.destroyAllExpired();

  const scanner = new ScannerService(db, paths, bootstrapLogger);
  const randomSelection = new SqliteRandomSelectionService(db);

  const ctx: AppContext = { db, paths, sessions, scanner, randomSelection };
  const app = await buildApp(ctx);

  scanner.scheduleFromSettings(settings.scanIntervalDays, settings.scanScheduleEnabled);

  const bindAddress = process.env.MEMORYLANE_BIND_ADDRESS ?? settings.bindAddress;
  const port = Number(process.env.MEMORYLANE_PORT ?? settings.port);

  await app.listen({ host: bindAddress, port });
  app.log.info({ bindAddress, port, dataDir: paths.dataDir }, "MemoryLane server started");

  if (!process.env.MEMORYLANE_NO_OPEN && (bindAddress === "127.0.0.1" || bindAddress === "localhost")) {
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
