import fs from "node:fs";
import path from "node:path";

export interface DetectedPhotosLibrary { path: string; readable: boolean; reason?: string }

export function detectPhotosLibraries(picturesDir: string): DetectedPhotosLibrary[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(picturesDir, { withFileTypes: true }); }
  catch { return []; }
  return entries.filter((entry) => entry.isDirectory() && entry.name.toLowerCase().endsWith(".photoslibrary"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const libraryPath = path.join(picturesDir, entry.name);
      try {
        const file = fs.openSync(path.join(libraryPath, "database", "Photos.sqlite"), "r");
        fs.closeSync(file);
        return { path: libraryPath, readable: true };
      } catch {
        return { path: libraryPath, readable: false, reason: "Photos catalogue is not accessible" };
      }
    });
}
