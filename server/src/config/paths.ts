import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Resolves MemoryLane's application-data directory (database, thumbnails, logs).
// This directory is entirely disposable/rebuildable from the source media - see PLAN.md section 12.
export function resolveAppDataDir(): string {
  const override = process.env.MEMORYLANE_DATA_DIR;
  if (override) return path.resolve(override);

  const platform = process.platform;
  if (platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "MemoryLane");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "MemoryLane");
  }
  // linux and other posix
  const xdgDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(xdgDataHome, "MemoryLane");
}

export interface AppPaths {
  dataDir: string;
  dbPath: string;
  thumbnailsDir: string;
  logsDir: string;
  clientDistDir: string;
}

export function resolveAppPaths(): AppPaths {
  const dataDir = resolveAppDataDir();
  const paths: AppPaths = {
    dataDir,
    dbPath: path.join(dataDir, "memorylane.sqlite"),
    thumbnailsDir: path.join(dataDir, "thumbnails"),
    logsDir: path.join(dataDir, "logs"),
    // import.meta.dirname is server/src/config (dev, tsx) or server/dist/config
    // (built) - either way, two levels up is the server package root, where
    // the Vite client build outputs directly (see client/vite.config.ts).
    clientDistDir: path.resolve(import.meta.dirname, "..", "..", "public"),
  };
  for (const dir of [paths.dataDir, paths.thumbnailsDir, paths.logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

// Shards a numeric media id into a nested thumbnail path so no single directory
// accumulates hundreds of thousands of files (NTFS/ext4 large-directory slowdown).
export function thumbnailPathForMediaId(thumbnailsDir: string, mediaId: number): string {
  const idStr = String(mediaId).padStart(6, "0");
  const shard1 = idStr.slice(-6, -4);
  const shard2 = idStr.slice(-4, -2);
  return path.join(thumbnailsDir, shard1, shard2, `${mediaId}.jpg`);
}
