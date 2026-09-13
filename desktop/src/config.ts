import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

// Separate from the server's own settings DB (server/src/db/settings-repo.ts)
// - this is only the desktop app's own preference for which port to launch
// the server on and whether to auto-start it, stored independently so the
// tray app works even before the server has ever run once.
export interface DesktopConfig {
  port: number;
  autoStart: boolean;
}

const DEFAULTS: DesktopConfig = { port: 4280, autoStart: true };

function configPath(): string {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

export function loadConfig(): DesktopConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config: DesktopConfig): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}
