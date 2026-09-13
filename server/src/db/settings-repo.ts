import type Database from "better-sqlite3";
import type { SettingsDto } from "@memorylane/shared";

const DEFAULTS: SettingsDto = {
  bindAddress: "0.0.0.0",
  port: 4280,
  scanIntervalDays: null,
  scanScheduleEnabled: false,
};

export class SettingsRepo {
  constructor(private db: Database.Database) {}

  getAll(): SettingsDto {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as {
      key: string;
      value: string;
    }[];
    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      bindAddress: map.get("bindAddress") ?? DEFAULTS.bindAddress,
      port: map.has("port") ? Number(map.get("port")) : DEFAULTS.port,
      scanIntervalDays: map.has("scanIntervalDays")
        ? map.get("scanIntervalDays") === "null"
          ? null
          : Number(map.get("scanIntervalDays"))
        : DEFAULTS.scanIntervalDays,
      scanScheduleEnabled: map.has("scanScheduleEnabled")
        ? map.get("scanScheduleEnabled") === "true"
        : DEFAULTS.scanScheduleEnabled,
    };
  }

  update(patch: Partial<SettingsDto>): SettingsDto {
    const upsert = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    const tx = this.db.transaction((entries: [string, string][]) => {
      for (const [key, value] of entries) upsert.run(key, value);
    });

    const entries: [string, string][] = [];
    if (patch.bindAddress !== undefined) entries.push(["bindAddress", patch.bindAddress]);
    if (patch.port !== undefined) entries.push(["port", String(patch.port)]);
    if (patch.scanIntervalDays !== undefined)
      entries.push(["scanIntervalDays", patch.scanIntervalDays === null ? "null" : String(patch.scanIntervalDays)]);
    if (patch.scanScheduleEnabled !== undefined)
      entries.push(["scanScheduleEnabled", String(patch.scanScheduleEnabled)]);

    if (entries.length > 0) tx(entries);
    return this.getAll();
  }
}
