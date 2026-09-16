import type Database from "better-sqlite3";

export const APPLE_PHOTOS_PLUGIN_ID = "apple-photos";

export function isApplePhotosEnabled(db: Database.Database): boolean {
  if (process.platform !== "darwin") return false;
  const row = db.prepare("SELECT enabled FROM plugin_settings WHERE id = ?").get(APPLE_PHOTOS_PLUGIN_ID) as
    | { enabled: number }
    | undefined;
  return row?.enabled === 1;
}

export function applePhotosPluginStatus(db: Database.Database) {
  return {
    id: APPLE_PHOTOS_PLUGIN_ID,
    name: "Apple Photos",
    available: process.platform === "darwin",
    enabled: isApplePhotosEnabled(db),
  };
}
