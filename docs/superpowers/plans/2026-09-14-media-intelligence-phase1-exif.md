# Media Intelligence Phase 1 (EXIF + Pipeline + Reports) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture every EXIF tag ExifTool reads into a queryable `media_exif` table, add the generic `media_analysis` job pipeline (with the `exif_full` backfill analyzer), centralise media listing SQL in a `MediaQuery` builder, and ship a Reports page with lens/camera/aperture/ISO/focal/year facets, a filtered grid, and CSV export.

**Architecture:** `processMediaItem` already has the full ExifTool `Tags` object; a pure `promoteTags()` module maps it to ~25 typed columns plus a stripped JSON dump, written by `ExifRepo` during scan. A DB-backed `AnalysisWorker` (modelled on `TranscodeWorker`) drains `media_analysis` rows per registered `Analyzer`; Phase 1 registers only `exif_full` (backfill for media indexed before this feature). All listing routes move onto `buildMediaQuery()` so EXIF filters, companion exclusion, and scope compose in one place; Reports routes are thin GROUP BY queries over the same builder.

**Tech Stack:** Node 20, TypeScript, Fastify 5, better-sqlite3 (sync), exiftool-vendored, zod, vitest (server), React 18 + React Router 6 + Tailwind 4 (client).

**Spec:** `docs/architecture/2026-09-14-media-intelligence-design.md` — sections 4, 6.1–6.2, 7, 8.1, 13 (Phase 1 row), 14.

## Global Constraints

- Never rename, move, or modify original files. All new state lives in the SQLite DB in the data dir (rebuildable).
- Every media-listing query must exclude companions (`live_photo_video_id` targets and `raw_pair_id` targets) unless explicitly asked not to — the builder does this by default.
- New schema only via a new numbered file in `server/migrations/`; never edit shipped migrations.
- `shared` must be rebuilt (`npm run build --workspace=shared`) before server/client typecheck sees new DTOs.
- Run all commands from the repo root unless a step says otherwise. Server tests: `npm test --workspace=server -- <path>`; full typecheck: `npm run typecheck`.
- Commit after every task with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Pre-existing bug fixed in passing (Task 3): `tags.FocalLength` is a string like `"100.0 mm"` at runtime, so `numOrNull(tags.FocalLength)` in `media-processor.ts` has always returned `null`.

## File Structure

**Server — create**
- `server/migrations/016_media_exif_and_analysis.sql` — `media_exif`, `media_analysis` tables + indexes.
- `server/src/exif/promote.ts` — pure `Tags → PromotedExif` mapping and tag-dump stripping. No DB.
- `server/src/exif/exif-repo.ts` — `ExifRepo`: upsert/read `media_exif`.
- `server/src/analysis/types.ts` — `Analyzer`, `AnalyzerOutcome`, `AnalysisMediaRow`.
- `server/src/analysis/analysis-repo.ts` — `AnalysisRepo`: queue SQL (ensureQueued, claimBatch, complete, reset…).
- `server/src/analysis/analysis-worker.ts` — `AnalysisWorker`: polling loop, pause-while-scanning, reconcile, status.
- `server/src/analysis/analyzers/exif-full.ts` — the `exif_full` analyzer.
- `server/src/analysis/registry.ts` — `createAnalyzers(db, logger)` → `Analyzer[]`.
- `server/src/query/media-query.ts` — `buildMediaQuery`, `mediaSelectSql`, `mediaCountSql`, companion fragments.
- `server/src/api/analysis-routes.ts` — `GET /api/analysis/status`, `POST /api/analysis/retry`.
- `server/src/api/reports-routes.ts` — `GET /api/reports/facets`, `GET /api/reports/export.csv`.
- `server/test/helpers/db.ts`, `server/test/helpers/app.ts` — in-memory DB + migrated schema; injectable Fastify app with an authenticated cookie.
- Tests under `server/test/**` (outside `src`, so `tsc` build ignores them; vitest finds `**/*.test.ts`).

**Server — modify**
- `server/src/media/exiftool-client.ts` — cache and expose the ExifTool version.
- `server/src/media/media-processor.ts` — write `media_exif` + mark `exif_full` done; fix focal length.
- `server/src/scanner/scanner-service.ts` — reset analysis rows on fingerprint change; `onScanFinished` listeners.
- `server/src/context.ts`, `server/src/server.ts`, `server/src/app.ts` — wire `AnalysisWorker` and new routes.
- `server/src/api/mappers.ts` — re-export companion fragments from the builder.
- `server/src/api/media-routes.ts` — add `GET /api/media` (filtered list).
- `server/src/api/folders-routes.ts`, `favorites-routes.ts`, `search-routes.ts`, `memories-routes.ts`, `home-routes.ts`, `server/src/db/engagement-repo.ts`, `server/src/media/random-selection-service.ts` — use the builder.

**Shared — modify**
- `shared/src/types.ts` — `AnalysisStatusDto`, `AnalyzerStatusDto`, `FacetBucketDto`, `ReportFacetsDto`, `FOCAL_BUCKETS`.
- `shared/src/validation.ts` — `exifFilterQuerySchema`, `mediaListQuerySchema`, `reportFacetsQuerySchema`, `retryAnalysisRequestSchema`, `REPORT_FACET_FIELDS`.

**Client — create/modify**
- `client/src/pages/ReportsPage.tsx`, `client/src/components/FacetPanel.tsx` — new.
- `client/src/api/client.ts`, `client/src/App.tsx`, `client/src/components/Layout.tsx`, `client/src/pages/SettingsPage.tsx` — modify.

**Docs** — `CLAUDE.md` (pipeline, builder, reports), design doc §7.1 note on flat tag keys.

---

### Task 1: Test infrastructure (in-memory migrated DB)

**Files:**
- Create: `server/test/helpers/db.ts`
- Create: `server/test/db/migrations.test.ts`

**Interfaces:**
- Produces: `createTestDb(): Database.Database` (in-memory, all migrations applied, WAL/pragmas as prod); `seedScanRoot(db, path?) => number`; `seedFolder(db, scanRootId, absolutePath, parentId?) => number`; `seedMedia(db, folderId, scanRootId, overrides?) => number` (returns media id; defaults to an active JPEG with `thumbnail_status='done'`).

- [ ] **Step 1: Write the helper**

```ts
// server/test/helpers/db.ts
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrate.js";

const silentLogger = { info() {}, warn() {}, error() {} } as unknown as import("pino").Logger;

// In-memory SQLite with the full production schema. runMigrations resolves
// server/migrations relative to src/db, and skips the pre-migration backup
// because ":memory:" doesn't exist on disk.
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // runMigrations is async only because of the backup step; the migrations
  // themselves run synchronously, so awaiting is unnecessary for :memory:.
  void runMigrations(db, ":memory:", silentLogger);
  return db;
}

export function seedScanRoot(db: Database.Database, path = "/library"): number {
  const info = db.prepare("INSERT INTO scan_roots (path, enabled) VALUES (?, 1)").run(path);
  return Number(info.lastInsertRowid);
}

export function seedFolder(db: Database.Database, scanRootId: number, absolutePath: string, parentId: number | null = null): number {
  const name = absolutePath.split("/").filter(Boolean).pop() ?? absolutePath;
  const info = db
    .prepare("INSERT INTO folders (scan_root_id, parent_id, name, absolute_path) VALUES (?, ?, ?, ?)")
    .run(scanRootId, parentId, name, absolutePath);
  return Number(info.lastInsertRowid);
}

export interface SeedMediaOverrides {
  filename?: string;
  media_type?: "image" | "raw" | "video";
  status?: "active" | "missing";
  thumbnail_status?: "pending" | "done" | "failed" | "unsupported";
  captured_date?: string | null;
  fingerprint?: string;
  fs_created_at?: string | null;
}

let seedCounter = 0;

export function seedMedia(db: Database.Database, folderId: number, scanRootId: number, o: SeedMediaOverrides = {}): number {
  seedCounter++;
  const filename = o.filename ?? `IMG_${String(seedCounter).padStart(4, "0")}.jpg`;
  const ext = filename.split(".").pop()!.toLowerCase();
  const info = db
    .prepare(
      `INSERT INTO media (parent_folder_id, scan_root_id, absolute_path, filename, extension, media_type,
         file_size, fs_created_at, fs_modified_at, fingerprint, thumbnail_status, status, captured_date)
       VALUES (?, ?, ?, ?, ?, ?, 1000, ?, '2020-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
    )
    .run(
      folderId, scanRootId, `/library/${folderId}/${filename}`, filename, ext, o.media_type ?? "image",
      o.fs_created_at ?? "2020-01-01T00:00:00.000Z", o.fingerprint ?? "1000:1", o.thumbnail_status ?? "done",
      o.status ?? "active", o.captured_date ?? null,
    );
  return Number(info.lastInsertRowid);
}
```

- [ ] **Step 2: Write the failing test**

```ts
// server/test/db/migrations.test.ts
import { describe, it, expect } from "vitest";
import { createTestDb, seedScanRoot, seedFolder, seedMedia } from "../helpers/db.js";

describe("migrations", () => {
  it("apply cleanly to an in-memory database and seed helpers work", () => {
    const db = createTestDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("media");
    expect(names).toContain("media_engagement");
    expect(names).toContain("media_exif");
    expect(names).toContain("media_analysis");

    const root = seedScanRoot(db);
    const folder = seedFolder(db, root, "/library/2019");
    const id = seedMedia(db, folder, root);
    expect(db.prepare("SELECT filename FROM media WHERE id = ?").get(id)).toEqual({ filename: "IMG_0001.jpg" });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test --workspace=server -- test/db/migrations.test.ts`
Expected: FAIL — `media_exif` / `media_analysis` not in the table list (Task 2 adds them).

- [ ] **Step 4: Commit**

```bash
git add server/test/helpers/db.ts server/test/db/migrations.test.ts
git commit -m "test: add in-memory migrated DB helper for server tests"
```

---

### Task 2: Migration 016 — `media_exif` and `media_analysis`

**Files:**
- Create: `server/migrations/016_media_exif_and_analysis.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Full EXIF capture (design doc §7.1). Promoted, typed, indexed columns for
-- the fields filters and reports use; tags_json holds everything else
-- ExifTool returned (flat tag names, binary/preview blobs stripped).
-- Kept off `media` for the same reason media_engagement is: it's a large,
-- derived superset, not filesystem truth.
CREATE TABLE media_exif (
  media_id             INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  -- Wall-clock capture time with milliseconds ("2024-05-12T10:31:44.250",
  -- no offset - offset is stored separately) so a camera's stream sorts and
  -- groups correctly for stacking. Falls back to media.fs_created_at when
  -- the file carries no EXIF date at all (scans, screenshots).
  captured_at_precise  TEXT,
  captured_tz_offset   TEXT,
  camera_make          TEXT,
  camera_model         TEXT,
  camera_serial        TEXT,
  lens_id              TEXT,
  lens_make            TEXT,
  lens_serial          TEXT,
  focal_length         REAL,
  focal_length_35mm    REAL,
  aperture             REAL,
  shutter_speed_s      REAL,
  iso                  INTEGER,
  exposure_compensation REAL,
  exposure_program     TEXT,
  metering_mode        TEXT,
  flash_fired          INTEGER,
  white_balance        TEXT,
  drive_mode           TEXT,
  burst_id             TEXT,
  shutter_count        INTEGER,
  rating               INTEGER,
  label                TEXT,
  keywords_json        TEXT,
  gps_lat              REAL,
  gps_lon              REAL,
  gps_alt              REAL,
  software             TEXT,
  tags_json            TEXT NOT NULL,
  exiftool_version     TEXT NOT NULL,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_media_exif_lens     ON media_exif(lens_id);
CREATE INDEX idx_media_exif_camera   ON media_exif(camera_model);
CREATE INDEX idx_media_exif_make     ON media_exif(camera_make);
CREATE INDEX idx_media_exif_aperture ON media_exif(aperture);
CREATE INDEX idx_media_exif_iso      ON media_exif(iso);
CREATE INDEX idx_media_exif_focal    ON media_exif(focal_length);
CREATE INDEX idx_media_exif_captured ON media_exif(captured_at_precise);

-- Generic per-media, per-analyzer job/result status (design doc §6.2).
-- Mirrors the thumbnail_status pattern: anything not 'done' is retried;
-- a model_version that differs from the registered analyzer's is re-queued
-- at startup, so swapping a model is a queue event, not a migration.
CREATE TABLE media_analysis (
  media_id          INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  analyzer          TEXT    NOT NULL,
  status            TEXT    NOT NULL, -- pending | running | done | failed | unsupported
  model_version     TEXT,
  input_fingerprint TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (media_id, analyzer)
);
CREATE INDEX idx_media_analysis_pending ON media_analysis(analyzer, status);
```

- [ ] **Step 2: Run the Task 1 test**

Run: `npm test --workspace=server -- test/db/migrations.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/migrations/016_media_exif_and_analysis.sql
git commit -m "feat(db): add media_exif and media_analysis tables"
```

---

### Task 3: `promoteTags` — pure EXIF promotion

**Files:**
- Create: `server/src/exif/promote.ts`
- Create: `server/test/exif/promote.test.ts`

**Interfaces:**
- Produces: `EXIF_PROMOTE_VERSION = "exif-promote-v1"`; `interface PromotedExif { capturedAtPrecise, capturedTzOffset, cameraMake, cameraModel, cameraSerial, lensId, lensMake, lensSerial, focalLength, focalLength35mm, aperture, shutterSpeedS, iso, exposureCompensation, exposureProgram, meteringMode, flashFired: 0|1|null, whiteBalance, driveMode, burstId, shutterCount, rating, label, keywords: string[]|null, gpsLat, gpsLon, gpsAlt, software }` (all `string|number|null` unless noted); `promoteTags(tags: Tags): PromotedExif`; `stripTagsForStorage(tags: Tags): Record<string, unknown>`; helpers `parseLeadingNumber`, `parseShutterSeconds`, `normalizeDriveMode`, `parseFlashFired`, `formatWallClock`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/test/exif/promote.test.ts
import { describe, it, expect } from "vitest";
import { ExifDateTime, type Tags } from "exiftool-vendored";
import {
  promoteTags, stripTagsForStorage, parseLeadingNumber, parseShutterSeconds,
  normalizeDriveMode, parseFlashFired, formatWallClock,
} from "../../src/exif/promote.js";

// Realistic subset of what exiftool-vendored returns for a Canon R5 CR3.
const canonTags = {
  Make: "Canon",
  Model: "Canon EOS R5",
  SerialNumber: "012345678901",
  LensModel: "RF100-500mm F4.5-7.1 L IS USM",
  LensID: "Canon RF 100-500mm F4.5-7.1L IS USM",
  LensSerialNumber: "9876543210",
  FocalLength: "500.0 mm",
  FocalLengthIn35mmFormat: "500 mm",
  FNumber: 7.1,
  ExposureTime: "1/2000",
  ShutterSpeed: "1/2000",
  ISO: 3200,
  ExposureCompensation: -0.33,
  ExposureProgram: "Manual",
  MeteringMode: "Evaluative",
  Flash: "Off, Did not fire",
  WhiteBalance: "Auto",
  DriveMode: "Continuous Shooting",
  ShutterCount: 40213,
  Rating: 3,
  Keywords: ["bird", "osprey"],
  GPSLatitude: 51.5,
  GPSLongitude: -0.12,
  GPSAltitude: 30,
  Software: "Adobe Lightroom",
  SubSecDateTimeOriginal: ExifDateTime.fromEXIF("2024:05:12 10:31:44.250+02:00"),
  DateTimeOriginal: ExifDateTime.fromEXIF("2024:05:12 10:31:44"),
  Orientation: 1,
  ThumbnailImage: "(Binary data 12345 bytes, use -b option to extract)",
  SourceFile: "/library/x.cr3",
  errors: [],
} as unknown as Tags;

describe("promoteTags", () => {
  it("promotes the common camera fields", () => {
    const p = promoteTags(canonTags);
    expect(p.cameraMake).toBe("Canon");
    expect(p.cameraModel).toBe("Canon EOS R5");
    expect(p.cameraSerial).toBe("012345678901");
    expect(p.lensId).toBe("Canon RF 100-500mm F4.5-7.1L IS USM");
    expect(p.lensSerial).toBe("9876543210");
    expect(p.focalLength).toBe(500);
    expect(p.focalLength35mm).toBe(500);
    expect(p.aperture).toBe(7.1);
    expect(p.shutterSpeedS).toBeCloseTo(1 / 2000, 8);
    expect(p.iso).toBe(3200);
    expect(p.exposureCompensation).toBe(-0.33);
    expect(p.exposureProgram).toBe("Manual");
    expect(p.flashFired).toBe(0);
    expect(p.driveMode).toBe("continuous");
    expect(p.shutterCount).toBe(40213);
    expect(p.rating).toBe(3);
    expect(p.keywords).toEqual(["bird", "osprey"]);
    expect(p.gpsLat).toBe(51.5);
    expect(p.gpsAlt).toBe(30);
    expect(p.software).toBe("Adobe Lightroom");
  });

  it("prefers the sub-second timestamp and keeps the offset separately", () => {
    const p = promoteTags(canonTags);
    expect(p.capturedAtPrecise).toBe("2024-05-12T10:31:44.250");
    expect(p.capturedTzOffset).toBe("+02:00");
  });

  it("falls back to DateTimeOriginal then CreateDate, and yields null with no date", () => {
    const noSub = { ...canonTags, SubSecDateTimeOriginal: undefined } as unknown as Tags;
    expect(promoteTags(noSub).capturedAtPrecise).toBe("2024-05-12T10:31:44.000");
    expect(promoteTags(noSub).capturedTzOffset).toBeNull();
    const onlyCreate = { CreateDate: ExifDateTime.fromEXIF("2019:01:02 03:04:05") } as unknown as Tags;
    expect(promoteTags(onlyCreate).capturedAtPrecise).toBe("2019-01-02T03:04:05.000");
    expect(promoteTags({} as Tags).capturedAtPrecise).toBeNull();
  });

  it("falls back to LensModel/Lens when LensID is absent and to Subject for keywords", () => {
    const p = promoteTags({ LensModel: "EF50mm f/1.8 STM", Subject: ["portrait"] } as unknown as Tags);
    expect(p.lensId).toBe("EF50mm f/1.8 STM");
    expect(p.keywords).toEqual(["portrait"]);
    expect(promoteTags({ Keywords: "single" } as unknown as Tags).keywords).toEqual(["single"]);
  });

  it("returns all-null fields for an empty tag set", () => {
    const p = promoteTags({} as Tags);
    expect(Object.values(p).every((v) => v === null)).toBe(true);
  });
});

describe("helpers", () => {
  it("parseLeadingNumber", () => {
    expect(parseLeadingNumber("100.0 mm")).toBe(100);
    expect(parseLeadingNumber(2.8)).toBe(2.8);
    expect(parseLeadingNumber("24")).toBe(24);
    expect(parseLeadingNumber("inf")).toBeNull();
    expect(parseLeadingNumber(undefined)).toBeNull();
  });
  it("parseShutterSeconds", () => {
    expect(parseShutterSeconds("1/250")).toBeCloseTo(0.004, 6);
    expect(parseShutterSeconds("30")).toBe(30);
    expect(parseShutterSeconds(0.5)).toBe(0.5);
    expect(parseShutterSeconds("1/2.5")).toBeCloseTo(0.4, 6);
    expect(parseShutterSeconds("Bulb")).toBeNull();
    expect(parseShutterSeconds(null)).toBeNull();
  });
  it("normalizeDriveMode", () => {
    expect(normalizeDriveMode("Continuous Shooting")).toBe("continuous");
    expect(normalizeDriveMode("Continuous High")).toBe("continuous");
    expect(normalizeDriveMode("Burst")).toBe("continuous");
    expect(normalizeDriveMode("Single Frame")).toBe("single");
    expect(normalizeDriveMode("Self-timer 10 sec")).toBe("timer");
    expect(normalizeDriveMode("Bracketing")).toBe("bracket");
    expect(normalizeDriveMode("Something Odd")).toBe("something odd");
    expect(normalizeDriveMode(undefined)).toBeNull();
  });
  it("parseFlashFired", () => {
    expect(parseFlashFired("Off, Did not fire")).toBe(0);
    expect(parseFlashFired("Auto, Did not fire")).toBe(0);
    expect(parseFlashFired("No Flash")).toBe(0);
    expect(parseFlashFired("On, Fired")).toBe(1);
    expect(parseFlashFired("Fired")).toBe(1);
    expect(parseFlashFired("Auto, Fired, Red-eye reduction")).toBe(1);
    expect(parseFlashFired(undefined)).toBeNull();
  });
  it("formatWallClock", () => {
    expect(formatWallClock(ExifDateTime.fromEXIF("2024:05:12 10:31:44.250+02:00")!)).toBe("2024-05-12T10:31:44.250");
    expect(formatWallClock(ExifDateTime.fromEXIF("2001:01:01 00:00:00")!)).toBe("2001-01-01T00:00:00.000");
  });
});

describe("stripTagsForStorage", () => {
  it("drops binary blobs, file-location keys and error arrays, and flattens date objects", () => {
    const out = stripTagsForStorage(canonTags);
    expect(out.ThumbnailImage).toBeUndefined();
    expect(out.SourceFile).toBeUndefined();
    expect(out.errors).toBeUndefined();
    expect(out.Make).toBe("Canon");
    expect(out.Keywords).toEqual(["bird", "osprey"]);
    expect(typeof out.DateTimeOriginal).toBe("string");
    expect(out.DateTimeOriginal).toBe("2024:05:12 10:31:44");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=server -- test/exif/promote.test.ts`
Expected: FAIL — cannot resolve `../../src/exif/promote.js`.

- [ ] **Step 3: Implement**

```ts
// server/src/exif/promote.ts
import type { Tags } from "exiftool-vendored";
import { ExifDateTime } from "exiftool-vendored";

// Bump whenever the mapping below changes in a way that should re-run over
// already-processed media - the analysis worker re-queues every media_exif
// row whose media_analysis.model_version differs (design doc §6.1).
export const EXIF_PROMOTE_VERSION = "exif-promote-v1";

export interface PromotedExif {
  capturedAtPrecise: string | null;
  capturedTzOffset: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  cameraSerial: string | null;
  lensId: string | null;
  lensMake: string | null;
  lensSerial: string | null;
  focalLength: number | null;
  focalLength35mm: number | null;
  aperture: number | null;
  shutterSpeedS: number | null;
  iso: number | null;
  exposureCompensation: number | null;
  exposureProgram: string | null;
  meteringMode: string | null;
  flashFired: 0 | 1 | null;
  whiteBalance: string | null;
  driveMode: string | null;
  burstId: string | null;
  shutterCount: number | null;
  rating: number | null;
  label: string | null;
  keywords: string[] | null;
  gpsLat: number | null;
  gpsLon: number | null;
  gpsAlt: number | null;
  software: string | null;
}

function str(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function int(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
}

// ExifTool renders many numeric tags with units ("100.0 mm", "500 mm") -
// exiftool-vendored only asks for raw numbers on a short numericTags list
// (GPS, Orientation, durations), so anything else arrives as a string.
export function parseLeadingNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// "1/250" -> 0.004, "30" -> 30, 0.5 -> 0.5. Anything non-numeric ("Bulb") -> null.
export function parseShutterSeconds(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const d = Number(frac[2]);
    return d > 0 ? Number(frac[1]) / d : null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Maker-note drive/shooting mode strings vary per brand ("Continuous
// Shooting", "Continuous High", "Single Frame", "Self-timer 10 sec"...).
// Collapse to a small vocabulary; unknown values pass through lowercased so
// nothing is lost, just un-normalised.
export function normalizeDriveMode(v: unknown): string | null {
  const s = str(v)?.toLowerCase() ?? null;
  if (!s) return null;
  if (/continuous|burst|high speed|sequential/.test(s)) return "continuous";
  if (/bracket/.test(s)) return "bracket";
  if (/timer/.test(s)) return "timer";
  if (/single/.test(s)) return "single";
  return s;
}

// ExifTool's Flash is a composite description: "Off, Did not fire",
// "Auto, Fired, Red-eye reduction", "No Flash", "Fired".
export function parseFlashFired(v: unknown): 0 | 1 | null {
  const s = str(v)?.toLowerCase() ?? null;
  if (!s) return null;
  if (/did not fire|no flash|^off\b/.test(s)) return 0;
  if (/fired|^on\b/.test(s)) return 1;
  return null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

// Wall-clock string without an offset - see media_exif.captured_at_precise.
export function formatWallClock(dt: ExifDateTime): string {
  return `${pad(dt.year, 4)}-${pad(dt.month)}-${pad(dt.day)}T${pad(dt.hour)}:${pad(dt.minute)}:${pad(dt.second)}.${pad(dt.millisecond ?? 0, 3)}`;
}

function firstDateTime(...candidates: unknown[]): ExifDateTime | null {
  for (const c of candidates) {
    if (c instanceof ExifDateTime) return c;
  }
  return null;
}

function keywords(tags: Tags): string[] | null {
  const raw = (tags.Keywords ?? tags.Subject) as unknown;
  if (raw == null) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const cleaned = list.map((k) => str(k)).filter((k): k is string => k !== null);
  return cleaned.length ? cleaned : null;
}

export function promoteTags(tags: Tags): PromotedExif {
  const t = tags as Record<string, unknown>;
  const dt = firstDateTime(t.SubSecDateTimeOriginal, t.DateTimeOriginal, t.CreateDate);
  return {
    capturedAtPrecise: dt ? formatWallClock(dt) : null,
    capturedTzOffset: dt?.zone ? String(dt.zone) : null,
    cameraMake: str(t.Make),
    cameraModel: str(t.Model),
    cameraSerial: str(t.SerialNumber),
    lensId: str(t.LensID) ?? str(t.LensModel) ?? str(t.Lens),
    lensMake: str(t.LensMake),
    lensSerial: str(t.LensSerialNumber),
    focalLength: parseLeadingNumber(t.FocalLength),
    focalLength35mm: parseLeadingNumber(t.FocalLengthIn35mmFormat),
    aperture: num(t.FNumber) ?? parseLeadingNumber(t.FNumber),
    shutterSpeedS: parseShutterSeconds(t.ExposureTime) ?? parseShutterSeconds(t.ShutterSpeed),
    iso: int(t.ISO),
    exposureCompensation: num(t.ExposureCompensation) ?? parseLeadingNumber(t.ExposureCompensation),
    exposureProgram: str(t.ExposureProgram),
    meteringMode: str(t.MeteringMode),
    flashFired: parseFlashFired(t.Flash),
    whiteBalance: str(t.WhiteBalance),
    driveMode: normalizeDriveMode(t.DriveMode ?? t.ShootingMode),
    burstId: str(t.BurstUUID),
    shutterCount: int(t.ShutterCount) ?? int(t.ImageCount),
    rating: int(t.Rating),
    label: str(t.Label),
    keywords: keywords(tags),
    gpsLat: num(t.GPSLatitude),
    gpsLon: num(t.GPSLongitude),
    gpsAlt: num(t.GPSAltitude),
    software: str(t.Software),
  };
}

const DROPPED_KEYS = new Set(["SourceFile", "Directory", "FileName", "FilePath", "errors", "warnings"]);

// Everything ExifTool returned, minus binary blobs (previews/thumbnails are
// multi-MB strings-of-bytes we never want in the DB), file-location keys
// (absolute_path already lives on media), and exiftool-vendored's own
// error/warning arrays. Date/time objects flatten to their raw EXIF text.
export function stripTagsForStorage(tags: Tags): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tags as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(key) || value == null) continue;
    if (typeof value === "string" && value.startsWith("(Binary data")) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      const v = value as { rawValue?: unknown; bytes?: unknown };
      if ("bytes" in v) continue; // BinaryField
      if (typeof v.rawValue === "string") {
        out[key] = v.rawValue;
        continue;
      }
      continue; // unknown object shape - not worth storing
    }
    out[key] = value;
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace=server -- test/exif/promote.test.ts`
Expected: PASS (all 4 + 6 + 1 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/exif/promote.ts server/test/exif/promote.test.ts
git commit -m "feat(exif): pure ExifTool tag promotion module"
```

---

### Task 4: `ExifRepo` — persist promoted EXIF

**Files:**
- Create: `server/src/exif/exif-repo.ts`
- Modify: `server/src/media/exiftool-client.ts` (cache version)
- Create: `server/test/exif/exif-repo.test.ts`

**Interfaces:**
- Consumes: `promoteTags`, `stripTagsForStorage` (Task 3); `seedMedia` (Task 1).
- Produces: `class ExifRepo { constructor(db); upsertFromTags(mediaId: number, tags: Tags | null, exiftoolVersion: string): void; get(mediaId: number): MediaExifRow | null }`; `interface MediaExifRow` (snake_case mirror of `media_exif` columns); `getExifToolVersion(): string` in exiftool-client.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/exif/exif-repo.test.ts
import { describe, it, expect } from "vitest";
import { ExifDateTime, type Tags } from "exiftool-vendored";
import { createTestDb, seedScanRoot, seedFolder, seedMedia } from "../helpers/db.js";
import { ExifRepo } from "../../src/exif/exif-repo.js";

function setup() {
  const db = createTestDb();
  const root = seedScanRoot(db);
  const folder = seedFolder(db, root, "/library/2024");
  return { db, root, folder, repo: new ExifRepo(db) };
}

describe("ExifRepo", () => {
  it("writes promoted columns and the stripped tag dump", () => {
    const { db, root, folder, repo } = setup();
    const id = seedMedia(db, folder, root);
    repo.upsertFromTags(
      id,
      { Make: "Nikon", Model: "NIKON Z 8", FNumber: 4, ISO: 800, FocalLength: "70.0 mm",
        DateTimeOriginal: ExifDateTime.fromEXIF("2024:03:01 08:00:00"), ThumbnailImage: "(Binary data 1 bytes)" } as unknown as Tags,
      "13.55",
    );
    const row = repo.get(id)!;
    expect(row.camera_model).toBe("NIKON Z 8");
    expect(row.aperture).toBe(4);
    expect(row.iso).toBe(800);
    expect(row.focal_length).toBe(70);
    expect(row.captured_at_precise).toBe("2024-03-01T08:00:00.000");
    expect(row.exiftool_version).toBe("13.55");
    const dump = JSON.parse(row.tags_json);
    expect(dump.Make).toBe("Nikon");
    expect(dump.ThumbnailImage).toBeUndefined();
  });

  it("falls back to media.fs_created_at when there is no EXIF capture date", () => {
    const { db, root, folder, repo } = setup();
    const id = seedMedia(db, folder, root, { fs_created_at: "2018-07-04T12:00:00.000Z" });
    repo.upsertFromTags(id, { Make: "Apple" } as unknown as Tags, "13.55");
    expect(repo.get(id)!.captured_at_precise).toBe("2018-07-04T12:00:00.000");
  });

  it("writes a minimal row when tags are null, and upserts on repeat", () => {
    const { db, root, folder, repo } = setup();
    const id = seedMedia(db, folder, root);
    repo.upsertFromTags(id, null, "unavailable");
    expect(repo.get(id)!.tags_json).toBe("{}");
    repo.upsertFromTags(id, { Make: "Sony" } as unknown as Tags, "13.55");
    expect(repo.get(id)!.camera_make).toBe("Sony");
    expect((db.prepare("SELECT COUNT(*) c FROM media_exif").get() as { c: number }).c).toBe(1);
  });

  it("returns null for unknown media", () => {
    const { repo } = setup();
    expect(repo.get(999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=server -- test/exif/exif-repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repo**

```ts
// server/src/exif/exif-repo.ts
import type Database from "better-sqlite3";
import type { Tags } from "exiftool-vendored";
import { promoteTags, stripTagsForStorage, type PromotedExif } from "./promote.js";

export interface MediaExifRow {
  media_id: number;
  captured_at_precise: string | null;
  captured_tz_offset: string | null;
  camera_make: string | null;
  camera_model: string | null;
  camera_serial: string | null;
  lens_id: string | null;
  lens_make: string | null;
  lens_serial: string | null;
  focal_length: number | null;
  focal_length_35mm: number | null;
  aperture: number | null;
  shutter_speed_s: number | null;
  iso: number | null;
  exposure_compensation: number | null;
  exposure_program: string | null;
  metering_mode: string | null;
  flash_fired: number | null;
  white_balance: string | null;
  drive_mode: string | null;
  burst_id: string | null;
  shutter_count: number | null;
  rating: number | null;
  label: string | null;
  keywords_json: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  gps_alt: number | null;
  software: string | null;
  tags_json: string;
  exiftool_version: string;
  updated_at: string;
}

const EMPTY: PromotedExif = {
  capturedAtPrecise: null, capturedTzOffset: null, cameraMake: null, cameraModel: null, cameraSerial: null,
  lensId: null, lensMake: null, lensSerial: null, focalLength: null, focalLength35mm: null, aperture: null,
  shutterSpeedS: null, iso: null, exposureCompensation: null, exposureProgram: null, meteringMode: null,
  flashFired: null, whiteBalance: null, driveMode: null, burstId: null, shutterCount: null, rating: null,
  label: null, keywords: null, gpsLat: null, gpsLon: null, gpsAlt: null, software: null,
};

export class ExifRepo {
  private upsertStmt: Database.Statement;
  private getStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.upsertStmt = db.prepare(
      `INSERT INTO media_exif (
         media_id, captured_at_precise, captured_tz_offset, camera_make, camera_model, camera_serial,
         lens_id, lens_make, lens_serial, focal_length, focal_length_35mm, aperture, shutter_speed_s, iso,
         exposure_compensation, exposure_program, metering_mode, flash_fired, white_balance, drive_mode,
         burst_id, shutter_count, rating, label, keywords_json, gps_lat, gps_lon, gps_alt, software,
         tags_json, exiftool_version, updated_at
       ) VALUES (
         @mediaId,
         -- Files with no EXIF date (scans, screenshots) fall back to the
         -- filesystem creation time so date filters still see them.
         COALESCE(@capturedAtPrecise, (SELECT substr(replace(fs_created_at, 'Z', ''), 1, 23) FROM media WHERE id = @mediaId)),
         @capturedTzOffset, @cameraMake, @cameraModel, @cameraSerial,
         @lensId, @lensMake, @lensSerial, @focalLength, @focalLength35mm, @aperture, @shutterSpeedS, @iso,
         @exposureCompensation, @exposureProgram, @meteringMode, @flashFired, @whiteBalance, @driveMode,
         @burstId, @shutterCount, @rating, @label, @keywordsJson, @gpsLat, @gpsLon, @gpsAlt, @software,
         @tagsJson, @exiftoolVersion, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       )
       ON CONFLICT(media_id) DO UPDATE SET
         captured_at_precise = excluded.captured_at_precise, captured_tz_offset = excluded.captured_tz_offset,
         camera_make = excluded.camera_make, camera_model = excluded.camera_model, camera_serial = excluded.camera_serial,
         lens_id = excluded.lens_id, lens_make = excluded.lens_make, lens_serial = excluded.lens_serial,
         focal_length = excluded.focal_length, focal_length_35mm = excluded.focal_length_35mm, aperture = excluded.aperture,
         shutter_speed_s = excluded.shutter_speed_s, iso = excluded.iso, exposure_compensation = excluded.exposure_compensation,
         exposure_program = excluded.exposure_program, metering_mode = excluded.metering_mode, flash_fired = excluded.flash_fired,
         white_balance = excluded.white_balance, drive_mode = excluded.drive_mode, burst_id = excluded.burst_id,
         shutter_count = excluded.shutter_count, rating = excluded.rating, label = excluded.label,
         keywords_json = excluded.keywords_json, gps_lat = excluded.gps_lat, gps_lon = excluded.gps_lon, gps_alt = excluded.gps_alt,
         software = excluded.software, tags_json = excluded.tags_json, exiftool_version = excluded.exiftool_version,
         updated_at = excluded.updated_at`,
    );
    this.getStmt = db.prepare("SELECT * FROM media_exif WHERE media_id = ?");
  }

  upsertFromTags(mediaId: number, tags: Tags | null, exiftoolVersion: string): void {
    const p = tags ? promoteTags(tags) : EMPTY;
    this.upsertStmt.run({
      mediaId,
      ...p,
      keywordsJson: p.keywords ? JSON.stringify(p.keywords) : null,
      tagsJson: tags ? JSON.stringify(stripTagsForStorage(tags)) : "{}",
      exiftoolVersion,
    });
  }

  get(mediaId: number): MediaExifRow | null {
    return (this.getStmt.get(mediaId) as MediaExifRow | undefined) ?? null;
  }
}
```

Note: better-sqlite3 named parameters reject unused keys, so `keywords` (an array) must not be in the bound object. Replace `...p` with an explicit object omitting `keywords`:

```ts
    const { keywords, ...cols } = p;
    this.upsertStmt.run({
      mediaId,
      ...cols,
      keywordsJson: keywords ? JSON.stringify(keywords) : null,
      tagsJson: tags ? JSON.stringify(stripTagsForStorage(tags)) : "{}",
      exiftoolVersion,
    });
```

- [ ] **Step 4: Expose the ExifTool version**

In `server/src/media/exiftool-client.ts`, add a module variable and set it in `checkExifToolAvailable`:

```ts
let cachedVersion = "unavailable";
// inside checkExifToolAvailable, replace `await et.version();` with:
    cachedVersion = await et.version();
// new export:
export function getExifToolVersion(): string {
  return cachedVersion;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test --workspace=server -- test/exif`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/exif/exif-repo.ts server/src/media/exiftool-client.ts server/test/exif/exif-repo.test.ts
git commit -m "feat(exif): ExifRepo persists promoted EXIF with fs_created_at fallback"
```

---

### Task 5: Analysis queue — `AnalysisRepo`

**Files:**
- Create: `server/src/analysis/types.ts`
- Create: `server/src/analysis/analysis-repo.ts`
- Create: `server/test/analysis/analysis-repo.test.ts`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type AnalysisStatus = "pending" | "running" | "done" | "failed" | "unsupported";
  export interface AnalysisMediaRow { id: number; parent_folder_id: number; absolute_path: string; media_type: "image" | "raw" | "video"; }
  export interface AnalyzerOutcome { mediaId: number; status: "done" | "failed" | "unsupported"; error?: string }
  export interface Analyzer { key: string; version: string; batchSize: number; appliesTo: string /* SQL predicate over `media` columns, e.g. "media_type IN ('image','raw')" */; run(rows: AnalysisMediaRow[]): Promise<AnalyzerOutcome[]> }
  ```
- Produces (analysis-repo.ts): `class AnalysisRepo { ensureQueued(a: Analyzer): number; requeueStaleVersions(a: Analyzer): number; markDone(mediaId, analyzerKey, version): void; resetForMedia(mediaId): void; claimBatch(analyzerKey, limit): AnalysisMediaRow[]; complete(analyzerKey, version, outcomes: AnalyzerOutcome[]): void; resetRunning(): number; retryFailed(analyzerKey?: string): number; counts(): { analyzer: string; status: AnalysisStatus; count: number }[] }`; `MAX_ATTEMPTS = 3`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/test/analysis/analysis-repo.test.ts
import { describe, it, expect } from "vitest";
import { createTestDb, seedScanRoot, seedFolder, seedMedia } from "../helpers/db.js";
import { AnalysisRepo, MAX_ATTEMPTS } from "../../src/analysis/analysis-repo.js";
import type { Analyzer } from "../../src/analysis/types.js";

const stills: Analyzer = { key: "t", version: "v1", batchSize: 10, appliesTo: "media_type IN ('image','raw')", run: async () => [] };

function setup() {
  const db = createTestDb();
  const root = seedScanRoot(db);
  const folder = seedFolder(db, root, "/library/a");
  const repo = new AnalysisRepo(db);
  return { db, root, folder, repo };
}

const statusOf = (db: ReturnType<typeof createTestDb>, id: number) =>
  (db.prepare("SELECT status, attempts, model_version FROM media_analysis WHERE media_id = ? AND analyzer = 't'").get(id) as
    { status: string; attempts: number; model_version: string | null } | undefined);

describe("AnalysisRepo", () => {
  it("ensureQueued adds pending rows only for matching active media, idempotently", () => {
    const { db, root, folder, repo } = setup();
    const a = seedMedia(db, folder, root);
    seedMedia(db, folder, root, { media_type: "video", filename: "v.mp4" });
    seedMedia(db, folder, root, { status: "missing" });
    expect(repo.ensureQueued(stills)).toBe(1);
    expect(repo.ensureQueued(stills)).toBe(0);
    expect(statusOf(db, a)?.status).toBe("pending");
  });

  it("claimBatch marks rows running and returns media rows; complete records outcomes", async () => {
    const { db, root, folder, repo } = setup();
    const a = seedMedia(db, folder, root);
    const b = seedMedia(db, folder, root);
    repo.ensureQueued(stills);
    const batch = repo.claimBatch("t", 5);
    expect(batch.map((r) => r.id).sort()).toEqual([a, b]);
    expect(statusOf(db, a)?.status).toBe("running");
    expect(repo.claimBatch("t", 5)).toEqual([]);

    repo.complete("t", "v1", [
      { mediaId: a, status: "done" },
      { mediaId: b, status: "failed", error: "boom" },
    ]);
    expect(statusOf(db, a)).toEqual({ status: "done", attempts: 1, model_version: "v1" });
    // First failure goes straight back to pending (retried up to MAX_ATTEMPTS).
    expect(statusOf(db, b)?.status).toBe("pending");
    expect(statusOf(db, b)?.attempts).toBe(1);
  });

  it("gives up after MAX_ATTEMPTS failures and retryFailed re-queues", () => {
    const { db, root, folder, repo } = setup();
    const a = seedMedia(db, folder, root);
    repo.ensureQueued(stills);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      repo.claimBatch("t", 5);
      repo.complete("t", "v1", [{ mediaId: a, status: "failed", error: "x" }]);
    }
    expect(statusOf(db, a)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(repo.claimBatch("t", 5)).toEqual([]);
    expect(repo.retryFailed("t")).toBe(1);
    expect(statusOf(db, a)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("markDone upserts a done row; requeueStaleVersions re-queues older versions only", () => {
    const { db, root, folder, repo } = setup();
    const a = seedMedia(db, folder, root);
    const b = seedMedia(db, folder, root);
    repo.markDone(a, "t", "v0");
    repo.markDone(b, "t", "v1");
    expect(repo.requeueStaleVersions(stills)).toBe(1);
    expect(statusOf(db, a)?.status).toBe("pending");
    expect(statusOf(db, b)?.status).toBe("done");
  });

  it("resetForMedia and resetRunning return rows to pending", () => {
    const { db, root, folder, repo } = setup();
    const a = seedMedia(db, folder, root);
    repo.markDone(a, "t", "v1");
    repo.resetForMedia(a);
    expect(statusOf(db, a)?.status).toBe("pending");
    repo.claimBatch("t", 5);
    expect(statusOf(db, a)?.status).toBe("running");
    expect(repo.resetRunning()).toBe(1);
    expect(statusOf(db, a)?.status).toBe("pending");
  });

  it("counts groups by analyzer and status", () => {
    const { db, root, folder, repo } = setup();
    seedMedia(db, folder, root);
    seedMedia(db, folder, root);
    repo.ensureQueued(stills);
    expect(repo.counts()).toEqual([{ analyzer: "t", status: "pending", count: 2 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=server -- test/analysis/analysis-repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types and repo**

```ts
// server/src/analysis/types.ts
import type { MediaType } from "@memorylane/shared";

export type AnalysisStatus = "pending" | "running" | "done" | "failed" | "unsupported";

export interface AnalysisMediaRow {
  id: number;
  parent_folder_id: number;
  absolute_path: string;
  media_type: MediaType;
}

export interface AnalyzerOutcome {
  mediaId: number;
  status: "done" | "failed" | "unsupported";
  error?: string;
}

// One unit of per-media work the AnalysisWorker knows how to schedule.
// `appliesTo` is a SQL predicate over `media` columns so ensureQueued can
// stay a single INSERT ... SELECT rather than a per-row JS filter.
export interface Analyzer {
  key: string;
  version: string;
  batchSize: number;
  appliesTo: string;
  run(rows: AnalysisMediaRow[]): Promise<AnalyzerOutcome[]>;
}
```

```ts
// server/src/analysis/analysis-repo.ts
import type Database from "better-sqlite3";
import type { Analyzer, AnalyzerOutcome, AnalysisMediaRow, AnalysisStatus } from "./types.js";

// A row that fails this many times stays 'failed' until an explicit retry
// (Settings > Analysis > Retry failed) - a poison file must not loop forever.
export const MAX_ATTEMPTS = 3;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export class AnalysisRepo {
  constructor(private db: Database.Database) {}

  // Pending rows for every active media item the analyzer applies to that
  // has no row yet. Safe to call repeatedly (PK conflict = ignored).
  ensureQueued(a: Analyzer): number {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO media_analysis (media_id, analyzer, status, updated_at)
         SELECT id, ?, 'pending', ${NOW} FROM media
         WHERE status = 'active' AND (${a.appliesTo})`,
      )
      .run(a.key);
    return info.changes;
  }

  requeueStaleVersions(a: Analyzer): number {
    return this.db
      .prepare(
        `UPDATE media_analysis SET status = 'pending', attempts = 0, error = NULL, updated_at = ${NOW}
         WHERE analyzer = ? AND status = 'done' AND (model_version IS NULL OR model_version != ?)`,
      )
      .run(a.key, a.version).changes;
  }

  // Used by the scan path, which produces the analyzer's result inline
  // (e.g. media_exif written by processMediaItem) without going through the queue.
  markDone(mediaId: number, analyzerKey: string, version: string): void {
    this.db
      .prepare(
        `INSERT INTO media_analysis (media_id, analyzer, status, model_version, input_fingerprint, attempts, error, updated_at)
         VALUES (?, ?, 'done', ?, (SELECT fingerprint FROM media WHERE id = ?), 0, NULL, ${NOW})
         ON CONFLICT(media_id, analyzer) DO UPDATE SET
           status = 'done', model_version = excluded.model_version, input_fingerprint = excluded.input_fingerprint,
           attempts = 0, error = NULL, updated_at = excluded.updated_at`,
      )
      .run(mediaId, analyzerKey, version, mediaId);
  }

  // The file changed on disk (fingerprint mismatch) - every analyzer's result is stale.
  resetForMedia(mediaId: number): void {
    this.db
      .prepare(`UPDATE media_analysis SET status = 'pending', attempts = 0, error = NULL, updated_at = ${NOW} WHERE media_id = ?`)
      .run(mediaId);
  }

  claimBatch(analyzerKey: string, limit: number): AnalysisMediaRow[] {
    const claim = this.db.transaction((): AnalysisMediaRow[] => {
      const rows = this.db
        .prepare(
          `SELECT media.id, media.parent_folder_id, media.absolute_path, media.media_type
           FROM media_analysis ma JOIN media ON media.id = ma.media_id
           WHERE ma.analyzer = ? AND ma.status = 'pending' AND media.status = 'active'
           ORDER BY ma.media_id LIMIT ?`,
        )
        .all(analyzerKey, limit) as AnalysisMediaRow[];
      if (rows.length === 0) return rows;
      const placeholders = rows.map(() => "?").join(",");
      this.db
        .prepare(`UPDATE media_analysis SET status = 'running', updated_at = ${NOW} WHERE analyzer = ? AND media_id IN (${placeholders})`)
        .run(analyzerKey, ...rows.map((r) => r.id));
      return rows;
    });
    return claim();
  }

  complete(analyzerKey: string, version: string, outcomes: AnalyzerOutcome[]): void {
    const done = this.db.prepare(
      `UPDATE media_analysis SET status = ?, model_version = ?, input_fingerprint = (SELECT fingerprint FROM media WHERE id = media_analysis.media_id),
         attempts = attempts + 1, error = NULL, updated_at = ${NOW}
       WHERE media_id = ? AND analyzer = ?`,
    );
    const failed = this.db.prepare(
      `UPDATE media_analysis SET
         attempts = attempts + 1,
         status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
         error = ?, updated_at = ${NOW}
       WHERE media_id = ? AND analyzer = ?`,
    );
    const tx = this.db.transaction((items: AnalyzerOutcome[]) => {
      for (const o of items) {
        if (o.status === "failed") failed.run(o.error ?? "unknown error", o.mediaId, analyzerKey);
        else done.run(o.status, version, o.mediaId, analyzerKey);
      }
    });
    tx(outcomes);
  }

  // Nothing survives a process restart, so 'running' can only mean "was
  // interrupted" at startup - same reasoning as TranscodeWorker.reconcileAndResume.
  resetRunning(): number {
    return this.db
      .prepare(`UPDATE media_analysis SET status = 'pending', updated_at = ${NOW} WHERE status = 'running'`)
      .run().changes;
  }

  retryFailed(analyzerKey?: string): number {
    const sql = `UPDATE media_analysis SET status = 'pending', attempts = 0, error = NULL, updated_at = ${NOW}
                 WHERE status IN ('failed', 'unsupported')${analyzerKey ? " AND analyzer = ?" : ""}`;
    const stmt = this.db.prepare(sql);
    return (analyzerKey ? stmt.run(analyzerKey) : stmt.run()).changes;
  }

  counts(): { analyzer: string; status: AnalysisStatus; count: number }[] {
    return this.db
      .prepare("SELECT analyzer, status, COUNT(*) as count FROM media_analysis GROUP BY analyzer, status ORDER BY analyzer, status")
      .all() as { analyzer: string; status: AnalysisStatus; count: number }[];
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace=server -- test/analysis/analysis-repo.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/analysis/types.ts server/src/analysis/analysis-repo.ts server/test/analysis/analysis-repo.test.ts
git commit -m "feat(analysis): media_analysis queue repository"
```

---

### Task 6: `AnalysisWorker` + `exif_full` analyzer + registry

**Files:**
- Create: `server/src/analysis/analysis-worker.ts`
- Create: `server/src/analysis/analyzers/exif-full.ts`
- Create: `server/src/analysis/registry.ts`
- Modify: `shared/src/types.ts` (append DTOs)
- Create: `server/test/analysis/analysis-worker.test.ts`

**Interfaces:**
- Consumes: `AnalysisRepo` (Task 5), `ExifRepo` (Task 4), `readTags`/`isExifToolAvailable`/`getExifToolVersion` (exiftool-client).
- Produces: `class AnalysisWorker { constructor(db, logger, analyzers: Analyzer[], isPaused: () => boolean, opts?: { idleMs?: number; pausedMs?: number }); start(): void; stop(): Promise<void>; kick(): void; enqueueAll(): number; runOnce(): Promise<number>; getStatus(): AnalysisStatusDto; retryFailed(analyzerKey?: string): number }`; `createExifFullAnalyzer(db): Analyzer`; `createAnalyzers(db, logger): Analyzer[]`.
- Shared DTOs:
  ```ts
  export type AnalysisStatus = "pending" | "running" | "done" | "failed" | "unsupported";
  export interface AnalyzerStatusDto { key: string; version: string; counts: Record<AnalysisStatus, number>; }
  export interface AnalysisStatusDto { paused: boolean; analyzers: AnalyzerStatusDto[]; }
  export interface RetryAnalysisRequest { analyzer?: string; }
  ```

- [ ] **Step 1: Add the shared DTOs**

Append to `shared/src/types.ts`:

```ts
// Background analysis pipeline (design doc §6) - per-analyzer queue counts
// shown under Settings > Analysis, polled like scan status.
export type AnalysisStatus = "pending" | "running" | "done" | "failed" | "unsupported";

export interface AnalyzerStatusDto {
  key: string;
  version: string;
  counts: Record<AnalysisStatus, number>;
}

export interface AnalysisStatusDto {
  // True while a scan is generating thumbnails - the worker yields to it.
  paused: boolean;
  analyzers: AnalyzerStatusDto[];
}

export interface RetryAnalysisRequest {
  analyzer?: string;
}
```

Run `npm run build --workspace=shared`.

Then in `server/src/analysis/types.ts` replace the local `AnalysisStatus` with `export type { AnalysisStatus } from "@memorylane/shared";` so there is one definition.

- [ ] **Step 2: Write the failing worker test**

```ts
// server/test/analysis/analysis-worker.test.ts
import { describe, it, expect } from "vitest";
import { createTestDb, seedScanRoot, seedFolder, seedMedia } from "../helpers/db.js";
import { AnalysisWorker } from "../../src/analysis/analysis-worker.js";
import { AnalysisRepo } from "../../src/analysis/analysis-repo.js";
import type { Analyzer, AnalysisMediaRow } from "../../src/analysis/types.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as import("pino").Logger;

function fakeAnalyzer(overrides: Partial<Analyzer> & { seen?: number[][] } = {}): Analyzer & { seen: number[][] } {
  const seen: number[][] = overrides.seen ?? [];
  return {
    key: "fake", version: "v1", batchSize: 2, appliesTo: "1=1",
    async run(rows: AnalysisMediaRow[]) {
      seen.push(rows.map((r) => r.id));
      return rows.map((r) => ({ mediaId: r.id, status: "done" as const }));
    },
    ...overrides,
    seen,
  };
}

function setup(n: number) {
  const db = createTestDb();
  const root = seedScanRoot(db);
  const folder = seedFolder(db, root, "/library/a");
  const ids = Array.from({ length: n }, () => seedMedia(db, folder, root));
  return { db, ids, repo: new AnalysisRepo(db) };
}

describe("AnalysisWorker", () => {
  it("enqueueAll + runOnce processes pending rows in batches of batchSize", async () => {
    const { db, ids } = setup(3);
    const a = fakeAnalyzer();
    const w = new AnalysisWorker(db, logger, [a], () => false);
    expect(w.enqueueAll()).toBe(3);
    expect(await w.runOnce()).toBe(2);
    expect(await w.runOnce()).toBe(1);
    expect(await w.runOnce()).toBe(0);
    expect(a.seen).toEqual([[ids[0], ids[1]], [ids[2]]]);
    const st = w.getStatus();
    expect(st.analyzers[0].counts.done).toBe(3);
    expect(st.analyzers[0].counts.pending).toBe(0);
  });

  it("marks the whole batch failed when run() throws", async () => {
    const { db } = setup(1);
    const a = fakeAnalyzer({ run: async () => { throw new Error("provider down"); } });
    const w = new AnalysisWorker(db, logger, [a], () => false);
    w.enqueueAll();
    await w.runOnce();
    const row = db.prepare("SELECT status, error, attempts FROM media_analysis").get() as { status: string; error: string; attempts: number };
    expect(row.attempts).toBe(1);
    expect(row.status).toBe("pending"); // retried until MAX_ATTEMPTS
    expect(row.error).toContain("provider down");
  });

  it("start() reconciles interrupted rows and re-queues stale versions", async () => {
    const { db, ids, repo } = setup(2);
    repo.markDone(ids[0], "fake", "v0");           // stale version
    repo.ensureQueued(fakeAnalyzer());
    repo.claimBatch("fake", 1);                     // simulate a crash mid-run
    const a = fakeAnalyzer();
    const w = new AnalysisWorker(db, logger, [a], () => false, { idleMs: 5 });
    w.start();
    await new Promise((r) => setTimeout(r, 100));
    await w.stop();
    const st = w.getStatus().analyzers[0].counts;
    expect(st.done).toBe(2);
    expect(st.running).toBe(0);
  });

  it("does not run while paused", async () => {
    const { db } = setup(1);
    const a = fakeAnalyzer();
    let paused = true;
    const w = new AnalysisWorker(db, logger, [a], () => paused, { idleMs: 5, pausedMs: 5 });
    w.start();
    await new Promise((r) => setTimeout(r, 40));
    expect(a.seen).toEqual([]);
    paused = false;
    await new Promise((r) => setTimeout(r, 60));
    await w.stop();
    expect(a.seen.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test --workspace=server -- test/analysis/analysis-worker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the worker, analyzer, registry**

```ts
// server/src/analysis/analysis-worker.ts
import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { AnalysisStatusDto, AnalysisStatus } from "@memorylane/shared";
import { AnalysisRepo } from "./analysis-repo.js";
import type { Analyzer } from "./types.js";

const EMPTY_COUNTS = (): Record<AnalysisStatus, number> => ({ pending: 0, running: 0, done: 0, failed: 0, unsupported: 0 });

// Drains media_analysis for every registered analyzer, in registration
// order. Polling loop rather than event-driven: work arrives in bulk (a scan,
// a startup backfill), and a 2s idle poll costs one indexed COUNT-free query.
// Yields entirely while a scan is running so thumbnail generation keeps its
// I/O budget (design doc §6.2).
export class AnalysisWorker {
  private repo: AnalysisRepo;
  private stopped = true;
  private loopPromise: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private needsEnqueue = false;
  private idleMs: number;
  private pausedMs: number;

  constructor(
    private db: Database.Database,
    private logger: Logger,
    private analyzers: Analyzer[],
    private isPaused: () => boolean,
    opts: { idleMs?: number; pausedMs?: number } = {},
  ) {
    this.repo = new AnalysisRepo(db);
    this.idleMs = opts.idleMs ?? 2000;
    this.pausedMs = opts.pausedMs ?? 5000;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const reset = this.repo.resetRunning();
    if (reset > 0) this.logger.warn({ count: reset }, "Re-queued analysis rows interrupted by a restart");
    for (const a of this.analyzers) {
      const stale = this.repo.requeueStaleVersions(a);
      if (stale > 0) this.logger.info({ analyzer: a.key, version: a.version, count: stale }, "Re-queued analysis rows from an older version");
    }
    this.enqueueAll();
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.loopPromise;
    this.loopPromise = null;
  }

  // Called after a scan: new media needs queue rows, and the loop may be idle.
  kick(): void {
    this.needsEnqueue = true;
    this.wake?.();
  }

  enqueueAll(): number {
    let total = 0;
    for (const a of this.analyzers) total += this.repo.ensureQueued(a);
    if (total > 0) this.logger.info({ count: total }, "Queued media for analysis");
    return total;
  }

  retryFailed(analyzerKey?: string): number {
    const n = this.repo.retryFailed(analyzerKey);
    this.wake?.();
    return n;
  }

  // One pass: for each analyzer, claim and process one batch. Returns the
  // number of rows processed so callers (and tests) can tell idle from busy.
  async runOnce(): Promise<number> {
    let processed = 0;
    for (const a of this.analyzers) {
      if (this.stopped && this.loopPromise) break;
      const rows = this.repo.claimBatch(a.key, a.batchSize);
      if (rows.length === 0) continue;
      try {
        const outcomes = await a.run(rows);
        this.repo.complete(a.key, a.version, outcomes);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error({ err, analyzer: a.key, count: rows.length }, "Analyzer batch failed");
        this.repo.complete(a.key, a.version, rows.map((r) => ({ mediaId: r.id, status: "failed" as const, error: message })));
      }
      processed += rows.length;
    }
    return processed;
  }

  getStatus(): AnalysisStatusDto {
    const byKey = new Map(this.analyzers.map((a) => [a.key, { key: a.key, version: a.version, counts: EMPTY_COUNTS() }]));
    for (const row of this.repo.counts()) {
      const entry = byKey.get(row.analyzer);
      if (entry) entry.counts[row.status] = row.count;
    }
    return { paused: this.isPaused(), analyzers: [...byKey.values()] };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.wake = null; resolve(); }, ms);
      t.unref();
      this.wake = () => { clearTimeout(t); this.wake = null; resolve(); };
    });
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      if (this.isPaused()) {
        await this.sleep(this.pausedMs);
        continue;
      }
      if (this.needsEnqueue) {
        this.needsEnqueue = false;
        this.enqueueAll();
      }
      let processed = 0;
      try {
        processed = await this.runOnce();
      } catch (err) {
        this.logger.error({ err }, "Analysis loop iteration failed");
      }
      if (processed === 0) await this.sleep(this.idleMs);
    }
  }
}
```

```ts
// server/src/analysis/analyzers/exif-full.ts
import type Database from "better-sqlite3";
import pLimit from "p-limit";
import { ExifRepo } from "../../exif/exif-repo.js";
import { EXIF_PROMOTE_VERSION } from "../../exif/promote.js";
import { readTags, isExifToolAvailable, getExifToolVersion } from "../../media/exiftool-client.js";
import type { Analyzer, AnalysisMediaRow, AnalyzerOutcome } from "../types.js";

export const EXIF_FULL_KEY = "exif_full";

// Backfill/re-run path for media_exif. The scan path writes media_exif
// inline (processMediaItem already holds the Tags) and calls markDone, so
// this analyzer only ever sees media indexed before the feature existed or
// rows re-queued by a version bump.
export function createExifFullAnalyzer(db: Database.Database): Analyzer {
  const repo = new ExifRepo(db);
  const limit = pLimit(2); // matches the ExifTool process pool (maxProcs: 2)
  return {
    key: EXIF_FULL_KEY,
    version: EXIF_PROMOTE_VERSION,
    batchSize: 20,
    appliesTo: "1=1",
    async run(rows: AnalysisMediaRow[]): Promise<AnalyzerOutcome[]> {
      if (!isExifToolAvailable()) {
        return rows.map((r) => ({ mediaId: r.id, status: "unsupported" as const, error: "ExifTool not available" }));
      }
      return Promise.all(
        rows.map((row) =>
          limit(async (): Promise<AnalyzerOutcome> => {
            try {
              const tags = await readTags(row.absolute_path);
              repo.upsertFromTags(row.id, tags, getExifToolVersion());
              return { mediaId: row.id, status: "done" };
            } catch (err) {
              return { mediaId: row.id, status: "failed", error: err instanceof Error ? err.message : String(err) };
            }
          }),
        ),
      );
    },
  };
}
```

```ts
// server/src/analysis/registry.ts
import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { Analyzer } from "./types.js";
import { createExifFullAnalyzer } from "./analyzers/exif-full.js";

// Registration order is execution order. Phase 1: EXIF only. Later phases
// append phash, embed_image, faces (design doc §13).
export function createAnalyzers(db: Database.Database, _logger: Logger): Analyzer[] {
  return [createExifFullAnalyzer(db)];
}
```

- [ ] **Step 5: Run tests**

Run: `npm test --workspace=server -- test/analysis`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types.ts server/src/analysis server/test/analysis/analysis-worker.test.ts
git commit -m "feat(analysis): AnalysisWorker with exif_full backfill analyzer"
```

---

### Task 7: Wire EXIF + worker into scan path, context, server, and status API

**Files:**
- Modify: `server/src/media/media-processor.ts`
- Modify: `server/src/scanner/scanner-service.ts`
- Modify: `server/src/context.ts`, `server/src/server.ts`, `server/src/app.ts`
- Create: `server/src/api/analysis-routes.ts`
- Modify: `shared/src/validation.ts` (append `retryAnalysisRequestSchema`)
- Create: `server/test/helpers/app.ts`
- Create: `server/test/api/analysis-routes.test.ts`

**Interfaces:**
- Consumes: `ExifRepo`, `AnalysisRepo.markDone/resetForMedia`, `AnalysisWorker`, `createAnalyzers`, `EXIF_FULL_KEY`, `EXIF_PROMOTE_VERSION`.
- Produces: `AppContext.analysisWorker: AnalysisWorker`; `ScannerService.onScanFinished(cb: () => void): void`; routes `GET /api/analysis/status → AnalysisStatusDto`, `POST /api/analysis/retry {analyzer?} → { requeued: number }`; test helper `createTestApp(): Promise<{ app: FastifyInstance; db; ctx: AppContext; cookie: string; close(): Promise<void> }>`.

- [ ] **Step 1: media-processor — write media_exif inline and fix focal length**

In `server/src/media/media-processor.ts`:

1. Add imports:
```ts
import { ExifRepo } from "../exif/exif-repo.js";
import { AnalysisRepo } from "../analysis/analysis-repo.js";
import { EXIF_PROMOTE_VERSION, parseLeadingNumber } from "../exif/promote.js";
import { EXIF_FULL_KEY } from "../analysis/analyzers/exif-full.js";
import { getExifToolVersion } from "./exiftool-client.js";  // merge with the existing exiftool-client import
```
2. In `extractMetadataFields`, replace `focalLength: numOrNull(tags.FocalLength),` with `focalLength: parseLeadingNumber(tags.FocalLength),` (ExifTool returns `"100.0 mm"`, so the old line always produced null).
3. In `processMediaItem`, keep the raw tags: change the metadata block to
```ts
  let tags: Tags | null = null;
  let metadata: ReturnType<typeof extractMetadataFields>;
  try {
    tags = isExifToolAvailable() ? await readTags(row.absolute_path) : null;
    metadata = extractMetadataFields(tags);
  } catch (err) {
    logger.error({ err, mediaId: row.id, path: row.absolute_path }, "Failed to read metadata");
    metadata = extractMetadataFields(null);
  }
```
4. After the final `linkRawJpegPair(...)` call inside the same try block, add:
```ts
    // Full EXIF capture (design doc §7.2) - written here because we already
    // hold the Tags, so the backfill analyzer never has to re-read this file.
    if (tags) {
      new ExifRepo(db).upsertFromTags(row.id, tags, getExifToolVersion());
      new AnalysisRepo(db).markDone(row.id, EXIF_FULL_KEY, EXIF_PROMOTE_VERSION);
    }
```
(Constructing the repos per call is fine: prepared statements are cached by better-sqlite3 per `db.prepare` call cost only; if profiling later shows it matters, hoist to module-level lazy singletons.)

- [ ] **Step 2: scanner — reset stale analysis and notify on finish**

In `server/src/scanner/scanner-service.ts`:
```ts
import { AnalysisRepo } from "../analysis/analysis-repo.js";
// class fields:
  private finishedListeners: (() => void)[] = [];
  private analysisRepo: AnalysisRepo;
// constructor body: this.analysisRepo = new AnalysisRepo(db);
// public method:
  onScanFinished(cb: () => void): void {
    this.finishedListeners.push(cb);
  }
// in runScan's finally block, after `this.running = false;`:
      for (const cb of this.finishedListeners) {
        try { cb(); } catch (err) { this.logger.error({ err }, "Scan-finished listener failed"); }
      }
// in indexFile, inside the `existing.fingerprint !== fingerprint` branch, right after the UPDATE:
      this.analysisRepo.resetForMedia(existing.id);
```

- [ ] **Step 3: context, server, app, routes**

`server/src/context.ts` — add `import type { AnalysisWorker } from "./analysis/analysis-worker.js";` and the field `analysisWorker: AnalysisWorker;`.

`server/src/server.ts` — after `transcodeWorker` construction:
```ts
  const analysisWorker = new AnalysisWorker(db, bootstrapLogger, createAnalyzers(db, bootstrapLogger), () => scanner.isRunning());
  const ctx: AppContext = { db, paths, sessions, scanner, randomSelection, transcodeWorker, analysisWorker };
```
after `transcodeWorker.reconcileAndResume();`:
```ts
  analysisWorker.start();
  scanner.onScanFinished(() => analysisWorker.kick());
```
in `shutdown`, before `await app.close();`: `await analysisWorker.stop();`.
Imports: `import { AnalysisWorker } from "./analysis/analysis-worker.js"; import { createAnalyzers } from "./analysis/registry.js";`

`shared/src/validation.ts` — append:
```ts
export const retryAnalysisRequestSchema = z.object({
  analyzer: z.string().min(1).max(64).optional(),
});
```
Rebuild shared.

`server/src/api/analysis-routes.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { retryAnalysisRequestSchema } from "@memorylane/shared";
import type { AppContext } from "../context.js";

export async function registerAnalysisRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/analysis/status", { preHandler: app.requireAuth }, async (_request, reply) => {
    return reply.send(ctx.analysisWorker.getStatus());
  });

  // Re-queues failed/unsupported rows (all analyzers, or one) - the only
  // way a row that hit MAX_ATTEMPTS runs again.
  app.post("/api/analysis/retry", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = retryAnalysisRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    return reply.send({ requeued: ctx.analysisWorker.retryFailed(parsed.data.analyzer) });
  });
}
```
`server/src/app.ts` — import and call `await registerAnalysisRoutes(app, ctx);` after `registerVideoTranscodeRoutes`.

- [ ] **Step 4: Test app helper**

```ts
// server/test/helpers/app.ts
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

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as import("pino").Logger;

// A fully routed Fastify app over an in-memory DB with one logged-in user.
// Scanner/transcode are inert stubs - route tests never trigger real scans.
export async function createTestApp() {
  process.env.LOG_LEVEL = "silent";
  const db = createTestDb();
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
  const scanner = { isRunning: () => false, onScanFinished() {}, getStatus: () => ({ running: false }), getHistory: () => [] } as unknown as ScannerService;
  const analysisWorker = new AnalysisWorker(db, logger, [], () => false);
  const ctx: AppContext = {
    db, paths, sessions, scanner,
    randomSelection: new SqliteRandomSelectionService(db),
    transcodeWorker: {} as TranscodeWorker,
    analysisWorker,
  };
  const app: FastifyInstance = await buildApp(ctx);
  return {
    app, db, ctx,
    cookie: `${SESSION_COOKIE_NAME}=${session.id}`,
    async close() { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}
```

- [ ] **Step 5: Write the route test**

```ts
// server/test/api/analysis-routes.test.ts
import { describe, it, expect } from "vitest";
import { createTestApp } from "../helpers/app.js";

describe("analysis routes", () => {
  it("requires auth and returns status", async () => {
    const t = await createTestApp();
    try {
      const anon = await t.app.inject({ method: "GET", url: "/api/analysis/status" });
      expect(anon.statusCode).toBe(401);
      const res = await t.app.inject({ method: "GET", url: "/api/analysis/status", headers: { cookie: t.cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ paused: false, analyzers: [] });
    } finally {
      await t.close();
    }
  });

  it("retry returns the re-queued count", async () => {
    const t = await createTestApp();
    try {
      const res = await t.app.inject({ method: "POST", url: "/api/analysis/retry", headers: { cookie: t.cookie }, payload: {} });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ requeued: 0 });
    } finally {
      await t.close();
    }
  });
});
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run build --workspace=shared && npm test --workspace=server && npm run typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add server/src shared/src server/test
git commit -m "feat(analysis): wire EXIF capture into scan path and start AnalysisWorker"
```

---

### Task 8: `buildMediaQuery` — single owner of media listing SQL

**Files:**
- Create: `server/src/query/media-query.ts`
- Modify: `server/src/api/mappers.ts` (re-export fragments from the builder)
- Modify: `shared/src/validation.ts`, `shared/src/types.ts` (filter schema, focal buckets)
- Create: `server/test/query/media-query.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const EXCLUDE_LIVE_PHOTO_VIDEOS: string; export const EXCLUDE_PAIRED_RAW: string;   // now `media.id NOT IN (...)`, moved here
  export function mediaTypeFilterClause(type: MediaTypeFilter): string;                       // moved here, qualified `media.media_type`
  export interface MediaQueryParams {
    scope?: { kind: "folder"; folderId: number; recursive: boolean } | { kind: "scanRoot"; scanRootId: number } | { kind: "ids"; ids: number[] };
    type?: MediaTypeFilter; includeCompanions?: boolean; thumbnailDone?: boolean; favoritesOnly?: boolean;
    exif?: ExifFilterQuery; requireExifJoin?: boolean;
  }
  export interface BuiltMediaQuery { cte: string; joins: string; where: string; bindings: unknown[] }
  export function buildMediaQuery(p: MediaQueryParams): BuiltMediaQuery;
  export const MEDIA_DEFAULT_ORDER = "media.captured_date IS NULL, media.captured_date, media.filename";
  export function mediaSelectSql(q: BuiltMediaQuery, orderBy?: string): string;  // ... LIMIT ? OFFSET ?  (caller appends limit, offset to bindings)
  export function mediaCountSql(q: BuiltMediaQuery): string;                      // SELECT COUNT(*) as c ...
  ```
- Shared:
  ```ts
  export const exifFilterQuerySchema = z.object({ lens, camera, make: z.string().min(1).max(200).optional(), apertureMin, apertureMax: z.coerce.number().positive().optional(), isoMin, isoMax: z.coerce.number().int().min(0).optional(), focalMin, focalMax: z.coerce.number().min(0).optional(), year: z.coerce.number().int().min(1800).max(2200).optional(), from, to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
  export type ExifFilterQuery = z.infer<typeof exifFilterQuerySchema>;
  export const mediaListQuerySchema = paginationQuerySchema.merge(exifFilterQuerySchema).extend({ type: mediaTypeFilterSchema, scanRootId: z.coerce.number().int().positive().optional() });
  export const FOCAL_BUCKETS: { key: string; label: string; min: number; max: number }[]  // in types.ts
  ```

- [ ] **Step 1: Shared additions**

`shared/src/validation.ts` — append:
```ts
// EXIF report filters - shared by GET /api/media, /api/reports/facets and
// /api/reports/export.csv so a facet click, the grid, and the CSV all agree.
export const exifFilterQuerySchema = z.object({
  lens: z.string().min(1).max(200).optional(),
  camera: z.string().min(1).max(200).optional(),
  make: z.string().min(1).max(200).optional(),
  apertureMin: z.coerce.number().positive().optional(),
  apertureMax: z.coerce.number().positive().optional(),
  isoMin: z.coerce.number().int().min(0).optional(),
  isoMax: z.coerce.number().int().min(0).optional(),
  focalMin: z.coerce.number().min(0).optional(),
  focalMax: z.coerce.number().min(0).optional(),
  year: z.coerce.number().int().min(1800).max(2200).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type ExifFilterQuery = z.infer<typeof exifFilterQuerySchema>;

export const mediaListQuerySchema = paginationQuerySchema.merge(exifFilterQuerySchema).extend({
  type: mediaTypeFilterSchema,
  scanRootId: z.coerce.number().int().positive().optional(),
});
```
`shared/src/types.ts` — append:
```ts
// Focal-length report buckets (mm). Shared so the facet value the server
// emits is exactly the key the client sends back as focalMin/focalMax.
export const FOCAL_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: "0-24", label: "≤ 24 mm", min: 0, max: 24 },
  { key: "25-35", label: "25–35 mm", min: 25, max: 35 },
  { key: "36-50", label: "36–50 mm", min: 36, max: 50 },
  { key: "51-85", label: "51–85 mm", min: 51, max: 85 },
  { key: "86-135", label: "86–135 mm", min: 86, max: 135 },
  { key: "136-200", label: "136–200 mm", min: 136, max: 200 },
  { key: "201-400", label: "201–400 mm", min: 201, max: 400 },
  { key: "401-9999", label: "> 400 mm", min: 401, max: 9999 },
];
```
Rebuild shared.

- [ ] **Step 2: Write the failing builder tests**

```ts
// server/test/query/media-query.test.ts
import { describe, it, expect } from "vitest";
import { createTestDb, seedScanRoot, seedFolder, seedMedia } from "../helpers/db.js";
import { buildMediaQuery, mediaSelectSql, mediaCountSql, type MediaQueryParams } from "../../src/query/media-query.js";

function run(db: ReturnType<typeof createTestDb>, p: MediaQueryParams, orderBy?: string): number[] {
  const q = buildMediaQuery(p);
  return (db.prepare(mediaSelectSql(q, orderBy)).all(...q.bindings, 100, 0) as { id: number }[]).map((r) => r.id).sort((a, b) => a - b);
}
function count(db: ReturnType<typeof createTestDb>, p: MediaQueryParams): number {
  const q = buildMediaQuery(p);
  return (db.prepare(mediaCountSql(q)).get(...q.bindings) as { c: number }).c;
}

function library() {
  const db = createTestDb();
  const root = seedScanRoot(db);
  const root2 = seedScanRoot(db, "/other");
  const top = seedFolder(db, root, "/library");
  const sub = seedFolder(db, root, "/library/sub", top);
  const other = seedFolder(db, root2, "/other");
  const jpg = seedMedia(db, top, root, { filename: "a.jpg" });
  const raw = seedMedia(db, top, root, { filename: "a.cr3", media_type: "raw" });
  const video = seedMedia(db, top, root, { filename: "v.mp4", media_type: "video" });
  const live = seedMedia(db, top, root, { filename: "live.mov", media_type: "video" });
  const missing = seedMedia(db, top, root, { filename: "gone.jpg", status: "missing" });
  const pendingThumb = seedMedia(db, sub, root, { filename: "sub.jpg", thumbnail_status: "pending" });
  const otherRoot = seedMedia(db, other, root2, { filename: "o.jpg" });
  db.prepare("UPDATE media SET raw_pair_id = ? WHERE id = ?").run(raw, jpg);
  db.prepare("UPDATE media SET live_photo_video_id = ? WHERE id = ?").run(live, jpg);
  return { db, root, root2, top, sub, jpg, raw, video, live, missing, pendingThumb, otherRoot };
}

describe("buildMediaQuery", () => {
  it("defaults: active media, companions hidden, all roots", () => {
    const L = library();
    expect(run(L.db, {})).toEqual([L.jpg, L.video, L.pendingThumb, L.otherRoot].sort((a, b) => a - b));
    expect(count(L.db, {})).toBe(4);
  });

  it("includeCompanions shows the paired RAW and Live Photo video", () => {
    const L = library();
    expect(run(L.db, { includeCompanions: true })).toContain(L.raw);
    expect(run(L.db, { includeCompanions: true })).toContain(L.live);
  });

  it("scopes to a folder, recursively or not, and to a scan root or id list", () => {
    const L = library();
    expect(run(L.db, { scope: { kind: "folder", folderId: L.top, recursive: false } })).toEqual([L.jpg, L.video]);
    expect(run(L.db, { scope: { kind: "folder", folderId: L.top, recursive: true } })).toEqual([L.jpg, L.video, L.pendingThumb]);
    expect(run(L.db, { scope: { kind: "scanRoot", scanRootId: L.root2 } })).toEqual([L.otherRoot]);
    expect(run(L.db, { scope: { kind: "ids", ids: [L.jpg, L.missing] } })).toEqual([L.jpg]);
    expect(run(L.db, { scope: { kind: "ids", ids: [] } })).toEqual([]);
  });

  it("filters by type and thumbnail status", () => {
    const L = library();
    expect(run(L.db, { type: "photo" })).toEqual([L.jpg, L.pendingThumb, L.otherRoot]);
    expect(run(L.db, { type: "video" })).toEqual([L.video]);
    expect(run(L.db, { thumbnailDone: true })).toEqual([L.jpg, L.video, L.otherRoot]);
  });

  it("favoritesOnly joins media_engagement", () => {
    const L = library();
    L.db.prepare("INSERT INTO media_engagement (media_id, favorite, favorited_at) VALUES (?, 1, '2024-01-01')").run(L.video);
    expect(run(L.db, { favoritesOnly: true }, "me.favorited_at DESC")).toEqual([L.video]);
  });

  it("EXIF filters join media_exif and combine with AND", () => {
    const L = library();
    const ins = L.db.prepare(
      `INSERT INTO media_exif (media_id, lens_id, camera_model, camera_make, aperture, iso, focal_length, captured_at_precise, tags_json, exiftool_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 't')`,
    );
    ins.run(L.jpg, "RF 100-500", "Canon EOS R5", "Canon", 7.1, 3200, 500, "2024-05-12T10:31:44.250");
    ins.run(L.otherRoot, "EF 50", "Canon EOS R5", "Canon", 1.8, 100, 50, "2019-06-01T12:00:00.000");
    expect(run(L.db, { exif: { lens: "RF 100-500" } })).toEqual([L.jpg]);
    expect(run(L.db, { exif: { camera: "Canon EOS R5" } })).toEqual([L.jpg, L.otherRoot]);
    expect(run(L.db, { exif: { apertureMax: 2 } })).toEqual([L.otherRoot]);
    expect(run(L.db, { exif: { isoMin: 1000 } })).toEqual([L.jpg]);
    expect(run(L.db, { exif: { focalMin: 36, focalMax: 50 } })).toEqual([L.otherRoot]);
    expect(run(L.db, { exif: { year: 2019 } })).toEqual([L.otherRoot]);
    expect(run(L.db, { exif: { from: "2024-01-01", to: "2024-12-31" } })).toEqual([L.jpg]);
    expect(run(L.db, { exif: { camera: "Canon EOS R5", isoMin: 1000 } })).toEqual([L.jpg]);
    // requireExifJoin without filters still restricts to rows with EXIF
    expect(run(L.db, { requireExifJoin: true })).toEqual([L.jpg, L.otherRoot]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test --workspace=server -- test/query`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the builder**

```ts
// server/src/query/media-query.ts
import type { MediaTypeFilter, ExifFilterQuery } from "@memorylane/shared";

// A Live Photo's paired video row must never appear as its own grid item -
// it's reachable only via the still photo's livePhotoVideoId.
export const EXCLUDE_LIVE_PHOTO_VIDEOS =
  "media.id NOT IN (SELECT live_photo_video_id FROM media WHERE live_photo_video_id IS NOT NULL)";

// A RAW paired with a same-name JPEG must never appear as its own grid item -
// it's reachable only via the image's rawPairId.
export const EXCLUDE_PAIRED_RAW = "media.id NOT IN (SELECT raw_pair_id FROM media WHERE raw_pair_id IS NOT NULL)";

// "photo" groups RAW with regular images - both are non-video stills from
// the user's point of view.
export function mediaTypeFilterClause(type: MediaTypeFilter): string {
  if (type === "photo") return "media.media_type IN ('image', 'raw')";
  if (type === "video") return "media.media_type = 'video'";
  return "1=1";
}

export type MediaScope =
  | { kind: "folder"; folderId: number; recursive: boolean }
  | { kind: "scanRoot"; scanRootId: number }
  | { kind: "ids"; ids: number[] };

export interface MediaQueryParams {
  scope?: MediaScope;
  type?: MediaTypeFilter;
  // Default false: companions (Live Photo videos, paired RAWs) are hidden.
  includeCompanions?: boolean;
  thumbnailDone?: boolean;
  // Joins media_engagement as `me` (so callers may ORDER BY me.favorited_at).
  favoritesOnly?: boolean;
  exif?: ExifFilterQuery;
  // Join media_exif as `mx` even with no EXIF filter (reports need the columns).
  requireExifJoin?: boolean;
}

export interface BuiltMediaQuery {
  cte: string;
  joins: string;
  where: string;
  bindings: unknown[];
}

export const MEDIA_DEFAULT_ORDER = "media.captured_date IS NULL, media.captured_date, media.filename";

const DESCENDANT_FOLDERS_CTE = `WITH RECURSIVE descendant_folders(id) AS (
  SELECT id FROM folders WHERE id = ? AND status = 'active'
  UNION ALL
  SELECT f.id FROM folders f JOIN descendant_folders d ON f.parent_id = d.id WHERE f.status = 'active'
)`;

const EXIF_KEYS: (keyof ExifFilterQuery)[] = [
  "lens", "camera", "make", "apertureMin", "apertureMax", "isoMin", "isoMax", "focalMin", "focalMax", "year", "from", "to",
];

export function hasExifFilter(exif: ExifFilterQuery | undefined): boolean {
  return !!exif && EXIF_KEYS.some((k) => exif[k] !== undefined);
}

// The one place media-listing WHERE clauses are assembled. Every clause is
// qualified with `media.` so joins (media_engagement, media_exif) never make
// a column ambiguous. Bindings are emitted in SQL order: CTE first, then WHERE.
export function buildMediaQuery(p: MediaQueryParams): BuiltMediaQuery {
  const cteBindings: unknown[] = [];
  const bindings: unknown[] = [];
  const where: string[] = ["media.status = 'active'"];
  const joins: string[] = [];
  let cte = "";

  const scope = p.scope;
  if (scope?.kind === "folder") {
    if (scope.recursive) {
      cte = DESCENDANT_FOLDERS_CTE;
      cteBindings.push(scope.folderId);
      where.push("media.parent_folder_id IN (SELECT id FROM descendant_folders)");
    } else {
      where.push("media.parent_folder_id = ?");
      bindings.push(scope.folderId);
    }
  } else if (scope?.kind === "scanRoot") {
    where.push("media.scan_root_id = ?");
    bindings.push(scope.scanRootId);
  } else if (scope?.kind === "ids") {
    if (scope.ids.length === 0) where.push("0=1");
    else {
      where.push(`media.id IN (${scope.ids.map(() => "?").join(",")})`);
      bindings.push(...scope.ids);
    }
  }

  if (!p.includeCompanions) where.push(EXCLUDE_LIVE_PHOTO_VIDEOS, EXCLUDE_PAIRED_RAW);
  if (p.type && p.type !== "all") where.push(mediaTypeFilterClause(p.type));
  if (p.thumbnailDone) where.push("media.thumbnail_status = 'done'");

  if (p.favoritesOnly) {
    joins.push("JOIN media_engagement me ON me.media_id = media.id");
    where.push("me.favorite = 1");
  }

  const exif = p.exif;
  if (p.requireExifJoin || hasExifFilter(exif)) {
    joins.push("JOIN media_exif mx ON mx.media_id = media.id");
  }
  if (exif) {
    const eq = (col: string, v: string | undefined) => { if (v !== undefined) { where.push(`${col} = ?`); bindings.push(v); } };
    const ge = (col: string, v: number | undefined) => { if (v !== undefined) { where.push(`${col} >= ?`); bindings.push(v); } };
    const le = (col: string, v: number | undefined) => { if (v !== undefined) { where.push(`${col} <= ?`); bindings.push(v); } };
    eq("mx.lens_id", exif.lens);
    eq("mx.camera_model", exif.camera);
    eq("mx.camera_make", exif.make);
    ge("mx.aperture", exif.apertureMin);
    le("mx.aperture", exif.apertureMax);
    ge("mx.iso", exif.isoMin);
    le("mx.iso", exif.isoMax);
    ge("mx.focal_length", exif.focalMin);
    le("mx.focal_length", exif.focalMax);
    if (exif.year !== undefined) { where.push("substr(mx.captured_at_precise, 1, 4) = ?"); bindings.push(String(exif.year)); }
    if (exif.from !== undefined) { where.push("mx.captured_at_precise >= ?"); bindings.push(`${exif.from}T00:00:00.000`); }
    if (exif.to !== undefined) { where.push("mx.captured_at_precise <= ?"); bindings.push(`${exif.to}T23:59:59.999`); }
  }

  return { cte, joins: joins.join(" "), where: where.join(" AND "), bindings: [...cteBindings, ...bindings] };
}

export function mediaSelectSql(q: BuiltMediaQuery, orderBy: string = MEDIA_DEFAULT_ORDER): string {
  return `${q.cte} SELECT media.* FROM media ${q.joins} WHERE ${q.where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
}

export function mediaCountSql(q: BuiltMediaQuery): string {
  return `${q.cte} SELECT COUNT(*) as c FROM media ${q.joins} WHERE ${q.where}`;
}
```

In `server/src/api/mappers.ts` delete the three definitions (`EXCLUDE_LIVE_PHOTO_VIDEOS`, `EXCLUDE_PAIRED_RAW`, `mediaTypeFilterClause`) and replace with:
```ts
export { EXCLUDE_LIVE_PHOTO_VIDEOS, EXCLUDE_PAIRED_RAW, mediaTypeFilterClause } from "../query/media-query.js";
```
(The fragments are now `media.`-qualified; every existing query selects `FROM media` so the qualification resolves. `video-compatibility.ts` embeds `EXCLUDE_LIVE_PHOTO_VIDEOS` in a query over `media` too — verify with `npm run typecheck` and the transcode candidates route still returning rows in the browser task.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run build --workspace=shared && npm test --workspace=server -- test/query && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/query/media-query.ts server/src/api/mappers.ts shared/src server/test/query
git commit -m "feat(query): buildMediaQuery as the single owner of media listing SQL"
```

---

### Task 9: Move existing listing routes onto the builder

**Files:**
- Modify: `server/src/api/folders-routes.ts`, `server/src/api/favorites-routes.ts`, `server/src/db/engagement-repo.ts`, `server/src/api/search-routes.ts`, `server/src/api/memories-routes.ts`, `server/src/api/home-routes.ts`, `server/src/media/random-selection-service.ts`
- Create: `server/test/api/listing-routes.test.ts`

**Interfaces:** consumes `buildMediaQuery`, `mediaSelectSql`, `mediaCountSql`, `MEDIA_DEFAULT_ORDER`. No new public interfaces; behaviour must be unchanged.

- [ ] **Step 1: Write the characterisation test first**

```ts
// server/test/api/listing-routes.test.ts
import { describe, it, expect } from "vitest";
import { createTestApp } from "../helpers/app.js";
import { seedScanRoot, seedFolder, seedMedia } from "../helpers/db.js";

async function seeded() {
  const t = await createTestApp();
  const root = seedScanRoot(t.db);
  const top = seedFolder(t.db, root, "/library");
  const sub = seedFolder(t.db, root, "/library/sub", top);
  const jpg = seedMedia(t.db, top, root, { filename: "a.jpg", captured_date: "2020-01-01T00:00:00.000Z" });
  const raw = seedMedia(t.db, top, root, { filename: "a.cr3", media_type: "raw" });
  const video = seedMedia(t.db, top, root, { filename: "v.mp4", media_type: "video" });
  const subJpg = seedMedia(t.db, sub, root, { filename: "b.jpg" });
  t.db.prepare("UPDATE media SET raw_pair_id = ? WHERE id = ?").run(raw, jpg);
  t.db.prepare("INSERT INTO media_engagement (media_id, favorite, favorited_at) VALUES (?, 1, '2024-01-01')").run(subJpg);
  return { t, root, top, sub, jpg, raw, video, subJpg };
}

const get = (t: Awaited<ReturnType<typeof createTestApp>>, url: string) =>
  t.app.inject({ method: "GET", url, headers: { cookie: t.cookie } });

describe("listing routes on the query builder", () => {
  it("folder media: direct, recursive, and type filter; paired RAW hidden", async () => {
    const S = await seeded();
    try {
      let r = await get(S.t, `/api/folders/${S.top}/media`);
      expect(r.json().items.map((m: { id: number }) => m.id)).toEqual([S.jpg, S.video]);
      expect(r.json().total).toBe(2);
      r = await get(S.t, `/api/folders/${S.top}/media?recursive=true`);
      expect(r.json().total).toBe(3);
      r = await get(S.t, `/api/folders/${S.top}/media?recursive=true&type=video`);
      expect(r.json().items.map((m: { id: number }) => m.id)).toEqual([S.video]);
    } finally { await S.t.close(); }
  });

  it("favorites lists only favorited, active, non-companion media", async () => {
    const S = await seeded();
    try {
      const r = await get(S.t, "/api/favorites");
      expect(r.json().items.map((m: { id: number }) => m.id)).toEqual([S.subJpg]);
      expect(r.json().items[0].favorite).toBe(true);
    } finally { await S.t.close(); }
  });

  it("search finds media by filename and hides companions", async () => {
    const S = await seeded();
    try {
      const r = await get(S.t, "/api/search?q=a");
      const mediaIds = r.json().items.filter((i: { type: string }) => i.type === "media").map((i: { media: { id: number } }) => i.media.id);
      expect(mediaIds).toContain(S.jpg);
      expect(mediaIds).not.toContain(S.raw);
    } finally { await S.t.close(); }
  });

  it("home summary hero and random memories pick only photos with thumbnails", async () => {
    const S = await seeded();
    try {
      const home = await get(S.t, "/api/home/summary");
      expect([S.jpg, S.subJpg]).toContain(home.json().heroMedia.id);
      const rnd = await get(S.t, "/api/memories/random?count=10");
      const ids = rnd.json().items.map((m: { id: number }) => m.id).sort();
      expect(ids).toEqual([S.jpg, S.subJpg].sort());
    } finally { await S.t.close(); }
  });
});
```

Run: `npm test --workspace=server -- test/api/listing-routes.test.ts` — Expected: PASS against the current code (this pins behaviour before the refactor). If any assertion fails, fix the test's expectation to match current behaviour, not the code.

- [ ] **Step 2: Refactor `folders-routes.ts` `/api/folders/:id/media`**

Replace the whole handler body after `const { offset, limit, recursive, type } = parsed.data;` with:
```ts
    const q = buildMediaQuery({ scope: { kind: "folder", folderId: id, recursive }, type });
    const total = (db.prepare(mediaCountSql(q)).get(...q.bindings) as { c: number }).c;
    const rows = db.prepare(mediaSelectSql(q)).all(...q.bindings, limit, offset) as MediaRow[];
    return reply.send({ items: engagement.attachFavorites(rows.map(toMediaDto)), total, offset, limit });
```
Import `buildMediaQuery, mediaCountSql, mediaSelectSql` from `../query/media-query.js`; remove the now-unused `mediaTypeFilterClause` import. Leave `getFolderCounts`/`getRecursiveFolderStats` and their `DESCENDANT_FOLDERS_CTE` as they are (they count folders and sizes, not listings).

- [ ] **Step 3: Refactor `engagement-repo.ts` `listFavoriteIds`**

```ts
  listFavoriteIds(offset: number, limit: number, type: MediaTypeFilter = "all"): { ids: number[]; total: number } {
    const q = buildMediaQuery({ favoritesOnly: true, type });
    const total = (this.db.prepare(mediaCountSql(q)).get(...q.bindings) as { c: number }).c;
    const rows = this.db
      .prepare(`SELECT media.id FROM media ${q.joins} WHERE ${q.where} ORDER BY me.favorited_at DESC LIMIT ? OFFSET ?`)
      .all(...q.bindings, limit, offset) as { id: number }[];
    return { ids: rows.map((r) => r.id), total };
  }
```
Replace the `EXCLUDE_*`/`mediaTypeFilterClause` import with `import { buildMediaQuery, mediaCountSql } from "../query/media-query.js";`.

- [ ] **Step 4: Refactor `search-routes.ts` media query**

```ts
    const q = buildMediaQuery({});
    const mediaRows = mediaLimit
      ? (db
          .prepare(
            `SELECT media.* FROM media_fts
             JOIN media ON media.id = media_fts.rowid ${q.joins}
             WHERE media_fts MATCH ? AND ${q.where}
             ORDER BY rank LIMIT ? OFFSET ?`,
          )
          .all(ftsQuery, ...q.bindings, mediaLimit, offset) as MediaRow[])
      : [];
```
Drop the `EXCLUDE_*` imports from mappers.

- [ ] **Step 5: Refactor `memories-routes.ts`, `home-routes.ts`, `random-selection-service.ts`**

memories: replace `ELIGIBLE_MEDIA_FILTER` with
```ts
const eligible = buildMediaQuery({ type: "photo", thumbnailDone: true });
const ELIGIBLE_MEDIA_FILTER = eligible.where; // no bindings: scope-less, so eligible.bindings is []
```
and keep the three tier queries as `SELECT media.id FROM media WHERE ${ELIGIBLE_MEDIA_FILTER} AND media.captured_date IS NOT NULL ...` (qualify `captured_date` → `media.captured_date` inside the `strftime` calls too).

home: hero query becomes
```ts
    const hero = buildMediaQuery({ type: "photo", thumbnailDone: true });
    const heroRow = db.prepare(`SELECT media.* FROM media WHERE ${hero.where} ORDER BY RANDOM() LIMIT 1`).get(...hero.bindings) as MediaRow | undefined;
```

random-selection-service: replace both `WHERE media.status = 'active' AND media.media_type IN ('image', 'raw') AND media.thumbnail_status = 'done' AND ${EXCLUDE_PAIRED_RAW}` fragments with `WHERE ${eligible.where}` where `const eligible = buildMediaQuery({ type: "photo", thumbnailDone: true });` is a module-level constant; import from `../query/media-query.js` instead of `../api/mappers.js`.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test --workspace=server && npm run typecheck`
Expected: all PASS (the characterisation test must still pass unchanged).

- [ ] **Step 7: Commit**

```bash
git add server/src server/test/api/listing-routes.test.ts
git commit -m "refactor(api): route media listings through buildMediaQuery"
```

---

### Task 10: `GET /api/media` filtered list + Reports facets + CSV export

**Files:**
- Modify: `server/src/api/media-routes.ts` (add list route)
- Create: `server/src/api/reports-routes.ts`
- Modify: `server/src/app.ts` (register)
- Modify: `shared/src/types.ts`, `shared/src/validation.ts`
- Create: `server/test/api/reports-routes.test.ts`

**Interfaces:**
- Shared:
  ```ts
  export const REPORT_FACET_FIELDS = ["lens", "camera", "make", "aperture", "iso", "focal", "year"] as const;   // validation.ts
  export type ReportFacetField = (typeof REPORT_FACET_FIELDS)[number];
  export const reportFacetsQuerySchema = exifFilterQuerySchema.extend({ type: mediaTypeFilterSchema, scanRootId: z.coerce.number().int().positive().optional() });
  export interface FacetBucketDto { value: string; label: string; count: number }                              // types.ts
  export interface ReportFacetsDto { total: number; facets: Record<ReportFacetField, FacetBucketDto[]> }
  ```
- Routes: `GET /api/media?<mediaListQuerySchema>` → `PaginatedResult<MediaDto>`; `GET /api/reports/facets?<reportFacetsQuerySchema>` → `ReportFacetsDto`; `GET /api/reports/export.csv?<reportFacetsQuerySchema>` → `text/csv` attachment.
- Server helper: `toMediaQueryParams(query: { type; scanRootId?; ...ExifFilterQuery })` → `MediaQueryParams` (exported from reports-routes.ts for reuse by media-routes).

- [ ] **Step 1: Shared additions**

`validation.ts` — append:
```ts
export const REPORT_FACET_FIELDS = ["lens", "camera", "make", "aperture", "iso", "focal", "year"] as const;
export type ReportFacetField = (typeof REPORT_FACET_FIELDS)[number];

export const reportFacetsQuerySchema = exifFilterQuerySchema.extend({
  type: mediaTypeFilterSchema,
  scanRootId: z.coerce.number().int().positive().optional(),
});
```
`types.ts` — append:
```ts
import type { ReportFacetField } from "./validation.js";   // add to the existing type import line at the top

export interface FacetBucketDto {
  // The filter value to send back (lens string, "2.8", "400", focal bucket key, "2019").
  value: string;
  label: string;
  count: number;
}

// Each facet is computed with its own filter removed (standard faceted
// search): selecting a lens narrows every other panel but still shows all lenses.
export interface ReportFacetsDto {
  total: number;
  facets: Record<ReportFacetField, FacetBucketDto[]>;
}
```
Rebuild shared.

- [ ] **Step 2: Write the failing route tests**

```ts
// server/test/api/reports-routes.test.ts
import { describe, it, expect } from "vitest";
import { createTestApp } from "../helpers/app.js";
import { seedScanRoot, seedFolder, seedMedia } from "../helpers/db.js";

async function seeded() {
  const t = await createTestApp();
  const root = seedScanRoot(t.db);
  const top = seedFolder(t.db, root, "/library");
  const ins = t.db.prepare(
    `INSERT INTO media_exif (media_id, lens_id, camera_model, camera_make, aperture, iso, focal_length, captured_at_precise, shutter_speed_s, tags_json, exiftool_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 't')`,
  );
  const a = seedMedia(t.db, top, root, { filename: "a.jpg" });
  const b = seedMedia(t.db, top, root, { filename: "b.jpg" });
  const c = seedMedia(t.db, top, root, { filename: "c.jpg" });
  seedMedia(t.db, top, root, { filename: "noexif.jpg" });
  ins.run(a, "RF 100-500", "Canon EOS R5", "Canon", 7.1, 3200, 500, "2024-05-12T10:31:44.250", 1 / 2000);
  ins.run(b, "RF 100-500", "Canon EOS R5", "Canon", 5.6, 800, 300, "2024-06-01T09:00:00.000", 1 / 500);
  ins.run(c, "EF 50", "Canon EOS 5D Mark IV", "Canon", 1.8, 100, 50, "2019-06-01T12:00:00.000", 1 / 125);
  return { t, a, b, c };
}
const get = (t: Awaited<ReturnType<typeof createTestApp>>, url: string) =>
  t.app.inject({ method: "GET", url, headers: { cookie: t.cookie } });

describe("reports", () => {
  it("facets: counts per field, each ignoring its own filter", async () => {
    const S = await seeded();
    try {
      const r = await get(S.t, "/api/reports/facets?lens=RF%20100-500");
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.total).toBe(2);
      // lens facet ignores the lens filter → both lenses listed
      expect(body.facets.lens).toEqual([
        { value: "RF 100-500", label: "RF 100-500", count: 2 },
        { value: "EF 50", label: "EF 50", count: 1 },
      ]);
      // other facets respect the lens filter
      expect(body.facets.camera).toEqual([{ value: "Canon EOS R5", label: "Canon EOS R5", count: 2 }]);
      expect(body.facets.aperture).toEqual([
        { value: "5.6", label: "f/5.6", count: 1 },
        { value: "7.1", label: "f/7.1", count: 1 },
      ]);
      expect(body.facets.focal).toEqual([
        { value: "201-400", label: "201–400 mm", count: 1 },
        { value: "401-9999", label: "> 400 mm", count: 1 },
      ]);
      expect(body.facets.year).toEqual([{ value: "2024", label: "2024", count: 2 }]);
      expect(body.facets.iso.map((b: { value: string }) => b.value)).toEqual(["800", "3200"]);
    } finally { await S.t.close(); }
  });

  it("GET /api/media applies the same filters with pagination", async () => {
    const S = await seeded();
    try {
      const r = await get(S.t, "/api/media?camera=Canon%20EOS%20R5&isoMin=1000&limit=10");
      expect(r.json().total).toBe(1);
      expect(r.json().items[0].id).toBe(S.a);
      const all = await get(S.t, "/api/media");
      expect(all.json().total).toBe(4); // no EXIF filter → no join → noexif.jpg included
    } finally { await S.t.close(); }
  });

  it("export.csv streams a header plus one row per match", async () => {
    const S = await seeded();
    try {
      const r = await get(S.t, "/api/reports/export.csv?year=2024");
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toContain("text/csv");
      expect(r.headers["content-disposition"]).toContain("attachment");
      const lines = r.body.trim().split("\n");
      expect(lines.length).toBe(3);
      expect(lines[0].startsWith("id,filename,absolute_path,captured_at,camera_make,camera_model")).toBe(true);
      expect(lines[1]).toContain("RF 100-500");
    } finally { await S.t.close(); }
  });

  it("rejects bad filter values", async () => {
    const S = await seeded();
    try {
      expect((await get(S.t, "/api/reports/facets?year=abc")).statusCode).toBe(400);
      expect((await get(S.t, "/api/media?from=2024-1-1")).statusCode).toBe(400);
    } finally { await S.t.close(); }
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test --workspace=server -- test/api/reports-routes.test.ts`
Expected: FAIL — 404s (routes don't exist).

- [ ] **Step 4: Implement reports routes**

```ts
// server/src/api/reports-routes.ts
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import {
  reportFacetsQuerySchema, REPORT_FACET_FIELDS, FOCAL_BUCKETS,
  type ReportFacetField, type ReportFacetsDto, type FacetBucketDto, type ExifFilterQuery, type MediaTypeFilter,
} from "@memorylane/shared";
import type { AppContext } from "../context.js";
import { buildMediaQuery, mediaCountSql, type MediaQueryParams } from "../query/media-query.js";

export interface MediaFilterQuery extends ExifFilterQuery {
  type: MediaTypeFilter;
  scanRootId?: number;
}

// Shared by /api/media, facets and export so all three see the same set.
export function toMediaQueryParams(q: MediaFilterQuery, extra: Partial<MediaQueryParams> = {}): MediaQueryParams {
  const { type, scanRootId, ...exif } = q;
  return {
    scope: scanRootId !== undefined ? { kind: "scanRoot", scanRootId } : undefined,
    type,
    exif,
    ...extra,
  };
}

// SQL expression + which filter keys the facet "owns" (removed when
// computing that facet so its full list stays visible while selected).
const FOCAL_CASE =
  "CASE " +
  FOCAL_BUCKETS.map((b) => `WHEN mx.focal_length <= ${b.max} THEN '${b.key}'`).join(" ") +
  " END";

const FACETS: Record<ReportFacetField, { expr: string; owns: (keyof ExifFilterQuery)[]; order: string; label: (v: string) => string }> = {
  lens:     { expr: "mx.lens_id",      owns: ["lens"],   order: "count DESC, value", label: (v) => v },
  camera:   { expr: "mx.camera_model", owns: ["camera"], order: "count DESC, value", label: (v) => v },
  make:     { expr: "mx.camera_make",  owns: ["make"],   order: "count DESC, value", label: (v) => v },
  aperture: { expr: "round(mx.aperture, 1)", owns: ["apertureMin", "apertureMax"], order: "CAST(value AS REAL)", label: (v) => `f/${v}` },
  iso:      { expr: "mx.iso",          owns: ["isoMin", "isoMax"],     order: "CAST(value AS INTEGER)", label: (v) => v },
  focal:    { expr: FOCAL_CASE,        owns: ["focalMin", "focalMax"], order: "CAST(substr(value, 1, instr(value, '-') - 1) AS INTEGER)",
              label: (v) => FOCAL_BUCKETS.find((b) => b.key === v)?.label ?? v },
  year:     { expr: "substr(mx.captured_at_precise, 1, 4)", owns: ["year"], order: "value DESC", label: (v) => v },
};

const MAX_BUCKETS = 60;

const CSV_COLUMNS = [
  "id", "filename", "absolute_path", "captured_at", "camera_make", "camera_model", "camera_serial", "lens",
  "focal_length_mm", "focal_length_35mm", "aperture", "shutter_speed_s", "iso", "exposure_compensation",
  "exposure_program", "metering_mode", "flash_fired", "white_balance", "drive_mode", "rating", "keywords",
  "gps_lat", "gps_lon", "software",
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function registerReportsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;

  app.get("/api/reports/facets", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = reportFacetsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    const query = parsed.data;

    const full = buildMediaQuery(toMediaQueryParams(query, { requireExifJoin: true }));
    const total = (db.prepare(mediaCountSql(full)).get(...full.bindings) as { c: number }).c;

    const facets = {} as Record<ReportFacetField, FacetBucketDto[]>;
    for (const field of REPORT_FACET_FIELDS) {
      const def = FACETS[field];
      const without = { ...query };
      for (const k of def.owns) delete (without as Record<string, unknown>)[k];
      const q = buildMediaQuery(toMediaQueryParams(without, { requireExifJoin: true }));
      const rows = db
        .prepare(
          `${q.cte} SELECT ${def.expr} AS value, COUNT(*) AS count FROM media ${q.joins}
           WHERE ${q.where} AND ${def.expr} IS NOT NULL
           GROUP BY value ORDER BY ${def.order} LIMIT ${MAX_BUCKETS}`,
        )
        .all(...q.bindings) as { value: string | number; count: number }[];
      facets[field] = rows.map((r) => ({ value: String(r.value), label: def.label(String(r.value)), count: r.count }));
    }

    const dto: ReportFacetsDto = { total, facets };
    return reply.send(dto);
  });

  // Streams promoted EXIF columns for every match. Rows are read lazily via
  // iterate() so a 500k-row export never materialises in memory.
  app.get("/api/reports/export.csv", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = reportFacetsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    const q = buildMediaQuery(toMediaQueryParams(parsed.data, { requireExifJoin: true }));
    const stmt = db.prepare(
      `${q.cte} SELECT media.id, media.filename, media.absolute_path, mx.captured_at_precise AS captured_at,
         mx.camera_make, mx.camera_model, mx.camera_serial, mx.lens_id AS lens, mx.focal_length AS focal_length_mm,
         mx.focal_length_35mm, mx.aperture, mx.shutter_speed_s, mx.iso, mx.exposure_compensation, mx.exposure_program,
         mx.metering_mode, mx.flash_fired, mx.white_balance, mx.drive_mode, mx.rating, mx.keywords_json AS keywords,
         mx.gps_lat, mx.gps_lon, mx.software
       FROM media ${q.joins} WHERE ${q.where} ORDER BY mx.captured_at_precise, media.filename`,
    );
    function* lines(): Generator<string> {
      yield CSV_COLUMNS.join(",") + "\n";
      for (const row of stmt.iterate(...q.bindings) as IterableIterator<Record<string, unknown>>) {
        const r = { ...row, keywords: row.keywords ? (JSON.parse(String(row.keywords)) as string[]).join("; ") : null };
        yield CSV_COLUMNS.map((c) => csvCell(r[c])).join(",") + "\n";
      }
    }
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="memorylane-report-${stamp}.csv"`);
    return reply.send(Readable.from(lines()));
  });
}
```

In `server/src/api/media-routes.ts` add, before the `/api/media/:id` route:
```ts
  // Library-wide filtered listing - backs the Reports grid. Same filter
  // vocabulary as /api/reports/facets and export.csv (see reports-routes.ts).
  app.get("/api/media", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = mediaListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    const { offset, limit, ...filters } = parsed.data;
    const q = buildMediaQuery(toMediaQueryParams(filters));
    const total = (db.prepare(mediaCountSql(q)).get(...q.bindings) as { c: number }).c;
    const rows = db.prepare(mediaSelectSql(q)).all(...q.bindings, limit, offset) as MediaRow[];
    return reply.send({ items: engagement.attachFavorites(rows.map(toMediaDto)), total, offset, limit });
  });
```
with imports `mediaListQuerySchema` (shared), `buildMediaQuery, mediaCountSql, mediaSelectSql` (query), `toMediaQueryParams` (reports-routes).

Register in `app.ts`: `await registerReportsRoutes(app, ctx);` after analysis routes.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run build --workspace=shared && npm test --workspace=server && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src shared/src server/test/api/reports-routes.test.ts
git commit -m "feat(reports): filtered media list, facet counts and CSV export"
```

---

### Task 11: Client — API wrapper, Reports page, nav

**Files:**
- Modify: `client/src/api/client.ts`
- Create: `client/src/components/FacetPanel.tsx`
- Create: `client/src/pages/ReportsPage.tsx`
- Modify: `client/src/App.tsx`, `client/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `GET /api/media`, `GET /api/reports/facets`, `GET /api/reports/export.csv` (Task 10); DTOs `ReportFacetsDto`, `FacetBucketDto`, `ReportFacetField`, `FOCAL_BUCKETS`, `ExifFilterQuery`, `MediaTypeFilter`.
- Produces: `api.media.list(params: ReportFilters, offset, limit)`, `api.reports.facets(params)`, `api.reports.exportUrl(params)`; `type ReportFilters = ExifFilterQuery & { type?: MediaTypeFilter }`; `toQueryString(params): string`.

- [ ] **Step 1: API wrapper**

In `client/src/api/client.ts` add to the type import: `ReportFacetsDto, ExifFilterQuery, AnalysisStatusDto`. Add above `export const api`:
```ts
export type ReportFilters = ExifFilterQuery & { type?: MediaTypeFilter };

// Serialises only defined filter values, so the same object drives the
// grid request, the facets request, and the CSV link.
export function toQueryString(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && !(k === "type" && v === "all")) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
```
Inside `media: { ... }` add:
```ts
    list: (filters: ReportFilters, offset = 0, limit = 200) =>
      request<PaginatedResult<MediaDto>>(`/api/media${toQueryString({ ...filters, offset, limit })}`),
```
Add new top-level groups:
```ts
  reports: {
    facets: (filters: ReportFilters) => request<ReportFacetsDto>(`/api/reports/facets${toQueryString(filters)}`),
    exportUrl: (filters: ReportFilters) => `/api/reports/export.csv${toQueryString(filters)}`,
  },
  analysis: {
    status: () => request<AnalysisStatusDto>("/api/analysis/status"),
    retryFailed: (analyzer?: string) =>
      request<{ requeued: number }>("/api/analysis/retry", { method: "POST", body: JSON.stringify(analyzer ? { analyzer } : {}) }),
  },
```

- [ ] **Step 2: FacetPanel component**

```tsx
// client/src/components/FacetPanel.tsx
import type { FacetBucketDto } from "@memorylane/shared";

interface FacetPanelProps {
  title: string;
  buckets: FacetBucketDto[];
  selected: string | undefined;
  onSelect: (value: string | undefined) => void;
}

// One report facet: rows of label + count with a proportional bar. Clicking
// a row filters by it; clicking the selected row clears it. Rendering is
// shared by every facet so lens/camera/aperture/... read identically.
export default function FacetPanel({ title, buckets, selected, onSelect }: FacetPanelProps) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
      <h3 className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {buckets.length === 0 ? (
        <p className="px-3 py-3 text-xs text-faint">No data</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1">
          {buckets.map((b) => {
            const isSelected = selected === b.value;
            return (
              <li key={b.value}>
                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? undefined : b.value)}
                  aria-pressed={isSelected}
                  title={b.label}
                  className={`relative flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition ${
                    isSelected ? "bg-accent text-page" : "text-ink hover:bg-hover"
                  }`}
                >
                  {!isSelected && (
                    <span
                      aria-hidden
                      className="absolute inset-y-1 left-0 rounded-r bg-chip"
                      style={{ width: `${max ? (b.count / max) * 100 : 0}%`, zIndex: 0 }}
                    />
                  )}
                  <span className="relative z-10 truncate">{b.label}</span>
                  <span className="relative z-10 shrink-0 tabular-nums text-xs opacity-80">{b.count.toLocaleString()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: ReportsPage**

```tsx
// client/src/pages/ReportsPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, X } from "lucide-react";
import { FOCAL_BUCKETS, type MediaDto, type ReportFacetsDto, type ReportFacetField, type MediaTypeFilter as MediaTypeFilterValue } from "@memorylane/shared";
import { api, type ReportFilters } from "../api/client";
import FacetPanel from "../components/FacetPanel";
import MediaGrid from "../components/MediaGrid";
import MediaTypeFilter from "../components/MediaTypeFilter";
import Viewer from "../components/Viewer";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";

const PAGE_SIZE = 200;

const FACET_TITLES: Record<ReportFacetField, string> = {
  lens: "Lens", camera: "Camera", make: "Make", aperture: "Aperture", iso: "ISO", focal: "Focal length", year: "Year",
};
const FACET_ORDER: ReportFacetField[] = ["lens", "camera", "aperture", "focal", "iso", "year", "make"];

// URL query string is the single source of truth for the current report, so
// a filtered view is bookmarkable/shareable and the back button works.
function filtersFromParams(sp: URLSearchParams): ReportFilters {
  const num = (k: string) => (sp.has(k) ? Number(sp.get(k)) : undefined);
  const str = (k: string) => sp.get(k) ?? undefined;
  return {
    lens: str("lens"), camera: str("camera"), make: str("make"),
    apertureMin: num("apertureMin"), apertureMax: num("apertureMax"),
    isoMin: num("isoMin"), isoMax: num("isoMax"),
    focalMin: num("focalMin"), focalMax: num("focalMax"),
    year: num("year"), from: str("from"), to: str("to"),
    type: (str("type") as MediaTypeFilterValue | undefined) ?? "all",
  };
}

// Which facet is "selected" is derived from the filters: exact-value facets
// map to one key, numeric facets to a min==max pair, focal to a bucket.
function selectedFor(field: ReportFacetField, f: ReportFilters): string | undefined {
  switch (field) {
    case "lens": return f.lens;
    case "camera": return f.camera;
    case "make": return f.make;
    case "year": return f.year !== undefined ? String(f.year) : undefined;
    case "aperture": return f.apertureMin !== undefined && f.apertureMin === f.apertureMax ? String(f.apertureMin) : undefined;
    case "iso": return f.isoMin !== undefined && f.isoMin === f.isoMax ? String(f.isoMin) : undefined;
    case "focal": return FOCAL_BUCKETS.find((b) => b.min === f.focalMin && b.max === f.focalMax)?.key;
  }
}

function applyFacet(field: ReportFacetField, value: string | undefined, f: ReportFilters): ReportFilters {
  const next = { ...f };
  switch (field) {
    case "lens": next.lens = value; break;
    case "camera": next.camera = value; break;
    case "make": next.make = value; break;
    case "year": next.year = value !== undefined ? Number(value) : undefined; break;
    case "aperture": next.apertureMin = next.apertureMax = value !== undefined ? Number(value) : undefined; break;
    case "iso": next.isoMin = next.isoMax = value !== undefined ? Number(value) : undefined; break;
    case "focal": {
      const b = FOCAL_BUCKETS.find((x) => x.key === value);
      next.focalMin = b?.min; next.focalMax = b?.max; break;
    }
  }
  return next;
}

function activeChips(f: ReportFilters, facets: ReportFacetsDto | null): { field: ReportFacetField | "dates"; label: string }[] {
  const chips: { field: ReportFacetField | "dates"; label: string }[] = [];
  for (const field of FACET_ORDER) {
    const v = selectedFor(field, f);
    if (v === undefined) continue;
    const label = facets?.facets[field].find((b) => b.value === v)?.label ?? v;
    chips.push({ field, label: `${FACET_TITLES[field]}: ${label}` });
  }
  if (f.from || f.to) chips.push({ field: "dates", label: `${f.from ?? "…"} → ${f.to ?? "…"}` });
  return chips;
}

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const [facets, setFacets] = useState<ReportFacetsDto | null>(null);
  const [media, setMedia] = useState<MediaDto[] | null>(null);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const setFilters = (next: ReportFilters) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined && v !== "" && !(k === "type" && v === "all")) sp.set(k, String(v));
    }
    setSearchParams(sp);
  };

  useEffect(() => {
    let cancelled = false;
    setMedia(null);
    void Promise.all([api.reports.facets(filters), api.media.list(filters, 0, PAGE_SIZE)]).then(([fx, page]) => {
      if (cancelled) return;
      setFacets(fx);
      setMedia(page.items);
      setMediaTotal(page.total);
    });
    return () => { cancelled = true; };
  }, [filters]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || media === null) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await api.media.list(filters, media.length, PAGE_SIZE);
      setMedia((prev) => [...(prev ?? []), ...res.items]);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [media, filters]);

  const hasMore = media !== null && media.length < mediaTotal;
  const sentinelRef = useInfiniteScroll(loadMore, hasMore, loadingMore);
  const chips = activeChips(filters, facets);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">Reports</h1>
          <p className="text-sm text-muted">
            {facets ? `${facets.total.toLocaleString()} photos with EXIF data match` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MediaTypeFilter value={filters.type ?? "all"} onChange={(type) => setFilters({ ...filters, type })} />
          <a
            href={api.reports.exportUrl(filters)}
            download
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-hover"
          >
            <Download size={14} strokeWidth={1.8} /> Export CSV
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5 text-muted">
          From
          <input type="date" value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
            className="rounded-md border border-border bg-page px-2 py-1 text-ink" />
        </label>
        <label className="flex items-center gap-1.5 text-muted">
          To
          <input type="date" value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })}
            className="rounded-md border border-border bg-page px-2 py-1 text-ink" />
        </label>
        {chips.map((c) => (
          <button
            key={c.field}
            type="button"
            onClick={() =>
              c.field === "dates"
                ? setFilters({ ...filters, from: undefined, to: undefined })
                : setFilters(applyFacet(c.field, undefined, filters))
            }
            className="flex items-center gap-1 rounded-full bg-chip px-2.5 py-1 text-xs text-ink hover:bg-hover"
          >
            {c.label} <X size={12} />
          </button>
        ))}
        {chips.length > 0 && (
          <button type="button" onClick={() => setFilters({ type: filters.type })} className="text-xs text-muted underline hover:text-ink">
            Clear all
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FACET_ORDER.map((field) => (
          <FacetPanel
            key={field}
            title={FACET_TITLES[field]}
            buckets={facets?.facets[field] ?? []}
            selected={selectedFor(field, filters)}
            onSelect={(v) => setFilters(applyFacet(field, v, filters))}
          />
        ))}
      </div>

      {media === null && <p className="text-sm text-muted">Loading photos…</p>}
      {media && media.length === 0 && (
        <p className="text-sm text-muted">
          No photos match. EXIF data is captured during scans - if the library was indexed before this feature, the backfill under Settings → Analysis fills it in.
        </p>
      )}
      {media && media.length > 0 && <MediaGrid items={media} onOpen={setViewerIndex} />}

      {hasMore && (
        <div ref={sentinelRef} className="flex min-h-[60px] items-center justify-center text-sm">
          {loadingMore && <span className="text-muted">Loading more ({media?.length ?? 0} / {mediaTotal})…</span>}
        </div>
      )}

      {media && viewerIndex !== null && (
        <Viewer items={media} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} total={mediaTotal} onRequestMore={loadMore} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Route and nav**

`client/src/App.tsx`: `import ReportsPage from "./pages/ReportsPage";` and add `<Route path="/reports" element={<ReportsPage />} />` after the favorites route.

`client/src/components/Layout.tsx`: import `BarChart3` from lucide-react and insert `{ to: "/reports", label: "Reports", icon: BarChart3 },` between Favorites and Settings in `navItems`.

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck --workspace=client && npm run build --workspace=client`
Expected: clean. (Tailwind class names used above — `bg-chip`, `bg-surface`, `text-faint`, `bg-hover` — all exist in `client/src/styles.css` `@theme`.)

- [ ] **Step 6: Commit**

```bash
git add client/src
git commit -m "feat(client): Reports page with EXIF facets, filtered grid and CSV export"
```

---

### Task 12: Client — Settings › Analysis section

**Files:**
- Modify: `client/src/pages/SettingsPage.tsx`

**Interfaces:** consumes `api.analysis.status()`, `api.analysis.retryFailed()` (Task 11), `AnalysisStatusDto`.

- [ ] **Step 1: State + polling**

Add `AnalysisStatusDto` to the shared type import. Add state and a poll that runs while work is outstanding:
```tsx
  const [analysis, setAnalysis] = useState<AnalysisStatusDto | null>(null);
  const analysisPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const analysisBusy = (a: AnalysisStatusDto | null) =>
    !!a && a.analyzers.some((x) => x.counts.pending > 0 || x.counts.running > 0);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      const st = await api.analysis.status();
      if (active) setAnalysis(st);
      return st;
    };
    void tick();
    analysisPollRef.current = setInterval(async () => {
      const st = await tick();
      if (!analysisBusy(st) && analysisPollRef.current) {
        clearInterval(analysisPollRef.current);
        analysisPollRef.current = null;
      }
    }, 3000);
    return () => {
      active = false;
      if (analysisPollRef.current) clearInterval(analysisPollRef.current);
    };
  }, []);

  const retryAnalysis = async () => {
    await api.analysis.retryFailed();
    setAnalysis(await api.analysis.status());
  };
```

- [ ] **Step 2: Section markup** — insert after the "Scanning" `</section>`:

```tsx
      <section>
        <h2 className="mb-1 font-serif text-lg font-semibold text-ink">Analysis</h2>
        <p className="mb-3 text-sm text-muted">
          Background processing that runs after scans - full EXIF capture for Reports. Pauses automatically while a scan is generating thumbnails.
        </p>
        {analysis && (
          <div className="flex flex-col gap-2 text-sm">
            {analysis.paused && <p className="text-muted">Paused while a scan is running.</p>}
            <table className="w-full max-w-xl text-left">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr><th className="py-1 pr-3">Analyzer</th><th className="py-1 pr-3">Done</th><th className="py-1 pr-3">Pending</th><th className="py-1 pr-3">Failed</th><th className="py-1">Unsupported</th></tr>
              </thead>
              <tbody className="tabular-nums text-ink">
                {analysis.analyzers.map((a) => (
                  <tr key={a.key} className="border-t border-border">
                    <td className="py-1.5 pr-3">{a.key} <span className="text-xs text-faint">{a.version}</span></td>
                    <td className="py-1.5 pr-3">{a.counts.done.toLocaleString()}</td>
                    <td className="py-1.5 pr-3">{(a.counts.pending + a.counts.running).toLocaleString()}</td>
                    <td className="py-1.5 pr-3">{a.counts.failed.toLocaleString()}</td>
                    <td className="py-1.5">{a.counts.unsupported.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {analysis.analyzers.some((a) => a.counts.failed + a.counts.unsupported > 0) && (
              <div><button onClick={() => void retryAnalysis()} className={buttonClass}>Retry failed</button></div>
            )}
          </div>
        )}
      </section>
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck --workspace=client`
```bash
git add client/src/pages/SettingsPage.tsx
git commit -m "feat(client): Analysis status section in Settings"
```

---

### Task 13: Docs — CLAUDE.md and design note

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture/2026-09-14-media-intelligence-design.md` (§7.1 note)

- [ ] **Step 1: CLAUDE.md**

Under "### Scanning & media pipeline" add a bullet:
```
- `processMediaItem` also writes the full ExifTool tag set to `media_exif` (`server/src/exif/`: `promoteTags` maps ~25 typed columns, the rest goes to `tags_json`) and marks the `exif_full` analyzer done for that row.
```
Add a new subsection after it:
```
### Analysis pipeline

`server/src/analysis/`: `media_analysis` holds one row per (media, analyzer) with `status`/`model_version`. `AnalysisWorker` (started in `server.ts`, on `AppContext`) polls pending rows per registered `Analyzer` (`registry.ts`), runs batches, and records outcomes; it pauses while a scan runs and is kicked by `scanner.onScanFinished`. On startup it resets `running` → `pending` and re-queues rows whose `model_version` differs from the analyzer's. Adding an analyzer = implement `Analyzer` (`types.ts`) and append it to `createAnalyzers`; bump its `version` to re-run it library-wide. Status/retry: `GET /api/analysis/status`, `POST /api/analysis/retry`.

### Media listing queries

`server/src/query/media-query.ts::buildMediaQuery` is the only place listing WHERE clauses are assembled (scope, type, companion exclusion, favorites, EXIF filters). Every listing route and `random-selection-service` use it; new filters go there, not in routes. Companion fragments are `media.`-qualified.

### Reports

`GET /api/media` (filtered list), `GET /api/reports/facets` (per-field counts, each ignoring its own filter), `GET /api/reports/export.csv` share `exifFilterQuerySchema` in `shared/`. `FOCAL_BUCKETS` in shared defines focal-length ranges used by both server and client. Client page: `client/src/pages/ReportsPage.tsx`, filters live in the URL query string.
```
Under "## Commands" replace `npm test               # vitest in server (no test files exist yet)` with:
```
npm test               # vitest, server/test/** (in-memory SQLite; run one file: npm test --workspace=server -- test/exif/promote.test.ts)
```
Remove the "no test files" note from "## Notes".

- [ ] **Step 2: Design doc** — in §7.1, change `tags_json TEXT NOT NULL, -- full ExifTool dump (-G1 groups), binary/preview tags stripped` to `tags_json TEXT NOT NULL, -- full ExifTool dump (flat tag names as exiftool-vendored returns them), binary/preview tags stripped`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/architecture
git commit -m "docs: document analysis pipeline, query builder and reports"
```

---

### Task 14: End-to-end verification in a browser

**Files:** none committed (fixes found here go into the task they belong to, each with its own commit).

- [ ] **Step 1: Build a fixture library with real EXIF**

```bash
LIB=/private/tmp/claude-501/-Volumes-MacStudio-Samsung-Data-projects-memorylane/86a96f47-8ddf-4c66-b5f4-3f80914dee5e/scratchpad/fixture-library
mkdir -p "$LIB/2024-osprey" "$LIB/2019-portraits"
node -e '
const sharp = require("sharp");
const path = require("path");
const lib = process.argv[1];
(async () => {
  for (let i = 1; i <= 6; i++) {
    await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 30 + i * 20, g: 120, b: 200 } } }).jpeg().toFile(path.join(lib, "2024-osprey", `IMG_${1000 + i}.jpg`));
  }
  for (let i = 1; i <= 3; i++) {
    await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 200, g: 80 + i * 30, b: 90 } } }).jpeg().toFile(path.join(lib, "2019-portraits", `DSC_${200 + i}.jpg`));
  }
})();' "$LIB"
cd "$LIB/2024-osprey" && exiftool -overwrite_original -Make=Canon -Model="Canon EOS R5" -SerialNumber=012345 -LensModel="RF100-500mm F4.5-7.1 L IS USM" -FNumber=7.1 -ExposureTime=1/2000 -ISO=3200 -FocalLength=500 -DateTimeOriginal="2024:05:12 10:31:44" *.jpg
cd "$LIB/2019-portraits" && exiftool -overwrite_original -Make=Canon -Model="Canon EOS 5D Mark IV" -LensModel="EF50mm f/1.8 STM" -FNumber=1.8 -ExposureTime=1/125 -ISO=100 -FocalLength=50 -DateTimeOriginal="2019:06:01 12:00:00" *.jpg
```

- [ ] **Step 2: Run the server on a throwaway data dir**

```bash
cd "/Volumes/MacStudio Samsung Data/projects/memorylane" && npm run build
MEMORYLANE_DATA_DIR=/private/tmp/claude-501/-Volumes-MacStudio-Samsung-Data-projects-memorylane/86a96f47-8ddf-4c66-b5f4-3f80914dee5e/scratchpad/data MEMORYLANE_PORT=4299 MEMORYLANE_BIND_ADDRESS=127.0.0.1 MEMORYLANE_NO_OPEN=1 npm start
```
(run in the background). Then with `curl -c cookies -b cookies`: `POST /api/auth/setup {username:"tester",password:"testpass123"}`, `POST /api/scan-roots {path: "<LIB>"}`, `POST /api/scans/run`, poll `GET /api/scans/status` until `running:false`.

- [ ] **Step 3: Verify the API**

- `GET /api/reports/facets` → `total: 9`, `facets.lens` has two entries (6 and 3), `facets.aperture` has `7.1` and `1.8`, `facets.year` has 2024 and 2019.
- `GET /api/media?lens=RF100-500mm%20F4.5-7.1%20L%20IS%20USM` → total 6.
- `GET /api/reports/export.csv?year=2019` → 4 lines.
- `GET /api/analysis/status` → `exif_full` done = 9, pending = 0.
- Backfill path: `sqlite3 <data>/memorylane.sqlite "DELETE FROM media_exif; DELETE FROM media_analysis;"`, restart the server, wait ~5 s, `GET /api/analysis/status` → done = 9 again and facets repopulated.

- [ ] **Step 4: Verify in the browser** (use the `run` skill, or Playwright via `npx --yes playwright@1.47.0 install chromium` + a short script) at `http://127.0.0.1:4299`:

1. Log in → nav shows **Reports** → open it: 7 facet panels populated, grid shows 9 thumbnails, header reads "9 photos with EXIF data match". Screenshot.
2. Click the R5 in **Camera** → grid shows 6, chip "Camera: Canon EOS R5" appears, **Lens** panel shows only the RF lens, URL contains `camera=`. Screenshot.
3. Click **Aperture f/7.1** while camera selected → still 6; click it again → cleared.
4. Set From `2019-01-01` To `2019-12-31` with camera cleared → 3 results.
5. Click **Export CSV** → browser downloads `memorylane-report-<date>.csv`.
6. Open **Settings** → **Analysis** table shows `exif_full` with Done 9. Screenshot.
7. Browse a folder → grid still lists correctly (builder refactor regression check); Favorites and Search still work; Home hero renders.

- [ ] **Step 5: Stop the server; delete the scratch data dir. Fix anything found (commit under the owning task's message prefix), re-run `npm test --workspace=server && npm run typecheck`.**

---

### Task 15: Pull request

- [ ] **Step 1:** `git push -u origin feature/media-intelligence-phase1-exif` (requires write access — see conversation: currently blocked on GitHub auth for `madhankk/memorylane`; resolve with `gh auth login` as an account with push rights, or fork).
- [ ] **Step 2:** `gh pr create --base main --title "Media intelligence phase 1: full EXIF capture, analysis pipeline, Reports" --body-file <(…)` — body: summary of the four deliverables, link to the design doc and this plan, test plan = Task 14 checklist, screenshots, and the trailer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-review

**Spec coverage (Phase 1 row of §13):** `media_exif` (T2, T4), promotion module + fixtures (T3), backfill analyzer (T6), `media_analysis` + `AnalysisWorker` in-process only (T5–T7), MediaQuery builder (T8–T9), Reports page with facets + CSV (T10–T12). §6.2 lifecycle: enqueue on scan (T7 via kick → ensureQueued), backoff for unreachable providers is Phase 3 (no provider analyzers yet — intentionally omitted), priority pause (T6 `isPaused`), reconcile on startup (T6 `start()`), status API (T7). §7.3 facets + CSV (T10). §14 tests for promote, media-query, worker (T3, T6, T8) — `stacks`/`persons` tests belong to later phases.

**Placeholder scan:** none; every code step has full code.

**Type consistency:** `AnalysisStatus` defined once in shared (T6 step 1 re-exports it into server types). `toMediaQueryParams` lives in reports-routes and is imported by media-routes (T10). `ReportFilters`/`toQueryString` defined in T11 step 1 and used in ReportsPage. `EXCLUDE_*` constants now live in the builder and are re-exported by mappers (T8) so `video-compatibility.ts` needs no change.
