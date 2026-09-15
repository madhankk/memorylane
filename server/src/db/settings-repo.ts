import type Database from "better-sqlite3";
import type { SettingsDto } from "@memorylane/shared";

const DEFAULTS: SettingsDto = {
  bindAddress: "0.0.0.0",
  port: 4280,
  scanIntervalDays: null,
  scanScheduleEnabled: false,
  stackGapSeconds: 2,
  stackMaxHamming: 14,
  stackMinCosine: 0.9,
  aiEnabled: true,
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
      stackGapSeconds: map.has("stackGapSeconds") ? Number(map.get("stackGapSeconds")) : DEFAULTS.stackGapSeconds,
      stackMaxHamming: map.has("stackMaxHamming") ? Number(map.get("stackMaxHamming")) : DEFAULTS.stackMaxHamming,
      stackMinCosine: map.has("stackMinCosine") ? Number(map.get("stackMinCosine")) : DEFAULTS.stackMinCosine,
      aiEnabled: map.has("aiEnabled") ? map.get("aiEnabled") === "true" : DEFAULTS.aiEnabled,
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
    if (patch.stackGapSeconds !== undefined) entries.push(["stackGapSeconds", String(patch.stackGapSeconds)]);
    if (patch.stackMaxHamming !== undefined) entries.push(["stackMaxHamming", String(patch.stackMaxHamming)]);
    if (patch.stackMinCosine !== undefined) entries.push(["stackMinCosine", String(patch.stackMinCosine)]);
    if (patch.aiEnabled !== undefined) entries.push(["aiEnabled", String(patch.aiEnabled)]);

    if (entries.length > 0) tx(entries);
    return this.getAll();
  }
}
