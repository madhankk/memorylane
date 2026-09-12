import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Logger } from "pino";

// Migrations live as source (server/migrations) but ship alongside the compiled
// output (server/dist/migrations) - resolve whichever exists next to this module.
function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(import.meta.dirname, "..", "..", "migrations"), // src/db -> server/migrations (dev)
    path.resolve(import.meta.dirname, "migrations"), // dist/db -> dist/migrations (build copies it here)
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`Could not locate migrations directory. Checked: ${candidates.join(", ")}`);
}

export function runMigrations(db: Database.Database, logger: Logger): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const migrationsDir = resolveMigrationsDir();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    logger.info({ migration: file }, "Applying database migration");
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
    });
    applyMigration();
  }
}
