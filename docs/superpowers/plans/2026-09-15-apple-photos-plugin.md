# Apple Photos Library Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status: plan only — not scheduled.** Roadmap §M, Phase 6. Depends on the scan-root `kind` seam (Task 1) and, for the best experience, on Phase 6's albums plugin (§K) and Phase 5's plugin loader; both dependencies are called out where they bite and have fallbacks so this plan can also run standalone.

**Goal:** Let a Mac user add their Apple Photos library as a scan root. MemoryLane indexes it read-only, recovers the real filenames/dates/EXIF summary/GPS from Photos' catalogue, imports favourites, keywords, albums and Apple's named people, keeps working for iCloud-optimised photos whose originals aren't on disk, and offers "Open in Photos" / "Download original" from the viewer.

**Architecture:** A Photos library is a package: `originals/` (unmodified files under UUID names), `database/Photos.sqlite` (the catalogue), `resources/derivatives/` (~2048 px previews). The plugin adds a scan-root kind `apple-photos`; the existing scanner walks `originals/` and `resources/derivatives/` while a **catalogue sync** (the `osxphotos` library, MIT, run inside the sidecar as a `photos-catalog` provider, against a *copy* of the database) supplies per-asset metadata keyed by UUID. Assets without a local original are indexed from their derivative and flagged `original_available = 0`. Everything is read-only toward Apple's package; all writes go to MemoryLane's own tables.

**Tech Stack:** existing server/client; sidecar gains `osxphotos>=0.76` (Python ≥ 3.10, MIT — verified installable against the sidecar venv on 2026-09-15); optional Swift PhotoKit helper (Task 9) shipped only with the desktop app.

**Spec:** `docs/architecture/2026-09-15-photo-mining-roadmap.md` §M (and §3 plugin seams, §J/§K for hidden/albums).

**Verified on this machine (2026-09-15, macOS 26.2):** `~/Pictures/Photos Library.photoslibrary` exists; reading inside it from a VS Code-launched shell returns *Operation not permitted* — the permission state in Task 3 is not hypothetical.

## Global Constraints

- **Never write inside `*.photoslibrary`.** Not the database, not `originals/`, not derivatives. The catalogue is read from a temp copy of `Photos.sqlite` (+ `-wal`/`-shm`), never the live file.
- Housekeeping trash/delete (§J) is **disabled** for `apple-photos` roots; hide (our flag) is allowed.
- Apple's people names are *suggestions*: they become user-confirmed assignments only after our own detector produced a face in the same box; nothing is invented.
- Same commit/trailer/test rules as earlier phases; each task ends green (`npm test`, `npm run typecheck`, sidecar `pytest`).
- Windows/Linux: the plugin registers but its "detect library" and root kind are hidden (`process.platform !== "darwin"`).

## File Structure

**Sidecar** — `memorylane_ai/photos_catalog.py` (osxphotos wrapper: open library copy, iterate assets → JSON), `main.py` (`POST /v1/photos/catalog`), `tests/test_photos_catalog.py` (against a tiny fixture library built from osxphotos' own test data, or skipped when unavailable).

**Server — create** — `server/migrations/021_scan_root_kind.sql`, `server/migrations/022_apple_photos.sql`; `server/src/plugins/apple-photos/{detect.ts, catalog-sync.ts, mapping.ts, routes.ts, index.ts}`; `server/src/scanner/root-kinds.ts` (seam); `server/src/media/analysis-input.ts` (derivative fallback); tests under `server/test/apple-photos/`.

**Server — modify** — `scanner/scanner-service.ts` (kind-aware walk + ignore rules), `api/scan-roots-routes.ts` (kind on create/list, detect endpoint), `api/mappers.ts` + `shared/src/types.ts` (`originalAvailable`, `sourceKind`), `providers/types.ts` + `sidecar-provider.ts` (`catalog()`), `analysis/analyzers/faces.ts` (Apple name bootstrap hook), `persons/person-service.ts` (`bootstrapFromCatalog`), `api/similar-routes.ts`/`media-routes.ts` (file serving falls back to derivative), `query/media-query.ts` (no change needed — rows are ordinary media).

**Client** — Settings › Scan Folders ("Apple Photos library found — Add"), Viewer banner + actions, root badge "Apple Photos", People page note "N names imported from Photos".

---

### Task 1: Scan-root kinds (core seam)

**Files:** `server/migrations/021_scan_root_kind.sql`, `server/src/scanner/root-kinds.ts`, `scanner-service.ts`, `scan-roots-routes.ts`, shared types/validation, tests.

- [ ] Migration: `ALTER TABLE scan_roots ADD COLUMN kind TEXT NOT NULL DEFAULT 'folder';` (`'folder' | 'apple-photos'`).
- [ ] `root-kinds.ts`: `interface RootKind { kind: string; walkRoots(root): { dir: string; label: string }[]; ignoreDir?(path): boolean; afterScan?(root, ctx): Promise<void> }`; registry `registerRootKind()`; `folder` kind = today's behaviour. Scanner asks the kind which directories to walk and calls `afterScan` (used by Task 4's catalogue sync).
- [ ] `CreateScanRootRequest.kind?` (default `folder`); `ScanRootDto.kind`; Settings shows a badge for non-folder kinds; delete/ignore unchanged.
- [ ] Tests: scanner walks the kind-provided dirs; `afterScan` fires once per root per run.

---

### Task 2: Detect a Photos library

**Files:** `plugins/apple-photos/detect.ts`, `scan-roots-routes.ts` (`GET /api/scan-roots/detect`), Settings UI.

- [ ] `detectPhotosLibraries(): { path, isSystemLibrary, readable: boolean, reason?: string }[]` — globs `~/Pictures/*.photoslibrary`, checks `database/Photos.sqlite` is stat-able; `readable=false` with `reason="permission"` on `EPERM` (the state verified on this machine).
- [ ] Settings › Scan Folders: card *"Apple Photos library found at … — Add"*; if unreadable: *"macOS hasn't allowed MemoryLane to read your Photos library. System Settings › Privacy & Security › Photos (or Full Disk Access) → enable it for the app you started MemoryLane from, then restart."* Excludes already-added paths.
- [ ] Tests: fixture directory shaped like a package; `EPERM` simulated via a stubbed `fs`.

---

### Task 3: Read-only catalogue access in the sidecar

**Files:** `memorylane_ai/photos_catalog.py`, `main.py`, `pyproject.toml` (`osxphotos` under an optional extra `[apple]`, installed by `npm run ai` on macOS), tests.

- [ ] `snapshot_catalog(library_path) -> tmpdir`: copy `database/Photos.sqlite`, `-wal`, `-shm` to a temp dir (retry once if a copy fails mid-write); never open the live file. `osxphotos.PhotosDB(dbfile=<copy>)`.
- [ ] `iter_assets(db) -> generator of dict`: `uuid, original_filename, path (original, may be None), path_derivatives[], date (adjusted, tz-aware), favorite, hidden, intrash, ismissing/incloud (→ original_available), keywords[], title, description, albums[{uuid,title}], persons[{name, uuid}], face_info[{person, center_x, center_y, size (normalised)}], latitude, longitude, exif_info{camera_make, camera_model, lens_model, focal_length, aperture, iso, exposure_time}`. Only fields osxphotos exposes; everything else stays with ExifTool on the file.
- [ ] `POST /v1/photos/catalog` — body `{ library_path, cursor?, limit=500 }` → `{ library: { path, version, count }, assets: [...], next_cursor }` (paged; a 100k library is ~200 calls). 400 if not a library, 403 if `EPERM` (with the permission hint), 503 if osxphotos isn't installed (`dataEgress: none`).
- [ ] Health: `capabilities.photos_catalog: true|false`.
- [ ] Tests: build a minimal library fixture with osxphotos' bundled test library if present (`tests/fixtures/` is too big for the repo — download on demand like the models, skipped offline); assert paging, `original_available` for a cloud asset, `EPERM` → 403.

---

### Task 4: Catalogue sync and mapping

**Files:** `server/migrations/022_apple_photos.sql`, `plugins/apple-photos/{catalog-sync.ts, mapping.ts}`, `providers/types.ts` + `sidecar-provider.ts` (`catalog(libraryPath, cursor)`), tests.

- [ ] Migration:
  ```sql
  ALTER TABLE media ADD COLUMN original_available INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE media ADD COLUMN source_kind TEXT;                 -- NULL | 'apple-photos'
  CREATE TABLE apple_photos_assets (
    media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
    scan_root_id INTEGER NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
    uuid TEXT NOT NULL, original_filename TEXT, title TEXT, description TEXT,
    favorite INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, in_trash INTEGER NOT NULL DEFAULT 0,
    derivative_path TEXT, keywords_json TEXT, albums_json TEXT, persons_json TEXT, faces_json TEXT,
    synced_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_apple_assets_uuid ON apple_photos_assets(scan_root_id, uuid);
  ```
- [ ] `afterScan` for the kind: page through `/v1/photos/catalog`; for each asset find the media row by absolute path of the original (or, when no original, by derivative path — Task 5 makes derivatives indexable); upsert `apple_photos_assets`; write into existing columns: `media.filename` ← original filename (display only; `absolute_path` stays the UUID file), `media_exif.captured_at_precise/tz` ← adjusted date when the file's EXIF has none, `gps_*` ← Photos location when absent, camera/lens/exposure summary ← `exif_info` when absent, `original_available` ← not `ismissing`; favourites → `media_engagement.favorite` (only sets, never clears); keywords/title/description → `media_fts` via a new FTS column or appended to `media_exif.keywords_json`.
- [ ] Hidden/in-trash assets → `media.hidden = 1` (uses §J's flag; until §J lands, use `status='missing'` with a note — fallback documented).
- [ ] Albums → `albums` plugin (§K) if present: manual albums named from Photos, items in Photos order, `source='apple-photos'`; otherwise skip with a log line (fallback).
- [ ] Tests: mapping is pure (`mapAssetToRows(asset, existingRows)` → intents) and table-driven; sync test against the fake sidecar returning three assets (local, cloud-only, trashed).

---

### Task 5: Indexing iCloud-optimised assets from derivatives

**Files:** `scanner/scanner-service.ts` (kind walks `resources/derivatives/` too, with `classifyExtension` limited to jpeg/heic), `media/analysis-input.ts`, `media-routes.ts` (`/file`, `/thumbnail` fallbacks), mappers/DTOs.

- [ ] For `apple-photos` roots the kind returns two walk dirs: `originals/` and `resources/derivatives/`. Derivative files are indexed **only** when the catalogue says the original is missing (otherwise they're skipped to avoid duplicates) — so the derivative walk runs inside `afterScan`, after the catalogue is known, not in the blind walk.
- [ ] `renderAnalysisJpeg`: when `original_available = 0`, use the derivative path from `apple_photos_assets` as the source. Thumbnails/previews generate from it normally.
- [ ] `GET /api/media/:id/file`: if the original is missing, serve the derivative with header `X-MemoryLane-Source: derivative`; `MediaDto.originalAvailable` drives the Viewer banner.
- [ ] Tests: a cloud-only fixture asset gets a thumbnail, an embedding-ready input, and `/file` returns the derivative.

---

### Task 6: People bootstrap from Apple's names

**Files:** `persons/person-service.ts` (`bootstrapFromCatalog(mediaId)`), `analyzers/faces.ts` (call after `replaceForMedia`), tests.

- [ ] After our detector writes faces for a media row that has `faces_json` from Photos: for each Apple face (centre + size, normalised) find our face with the highest IoU (≥ 0.4 — Apple's box is a face-centred square, ours is the detector's rectangle); if the Apple person has a name, `assignFace(faceId, person)` as **user**-assigned to the person with that name (create the person named accordingly if none exists; auto_label kept stable). Unnamed Apple faces are ignored.
- [ ] Idempotent: re-running the analyzer re-applies the same mapping; user changes made afterwards win (an existing `user` assignment is never overwritten).
- [ ] People page note: *"N people imported from Apple Photos"*.
- [ ] Tests: overlap mapping, name → person creation/merge by exact name, user edits survive re-run.

---

### Task 7: Viewer — "original in iCloud" state and actions

**Files:** `client/src/components/Viewer.tsx`, `plugins/apple-photos/routes.ts`, tests.

- [ ] Banner when `originalAvailable === false`: *"Original is in iCloud (Optimize Mac Storage) — showing Apple's preview."* Buttons: **Open in Photos**, **Download original** (only when the helper from Task 9 is present; otherwise hidden), and for the RAW/Info panel a note that full EXIF comes after download.
- [ ] `POST /api/plugins/apple-photos/open-in-photos { mediaId }` → `osascript -e 'tell application "Photos" to spotlight media item id "<uuid>"'`; first use triggers macOS's Automation prompt — surface the failure text if denied.
- [ ] Tests: route builds the AppleScript with the uuid escaped; banner renders from the DTO flag (component test optional).

---

### Task 8: Rescan behaviour and safety rails

- [ ] Rescans re-run the catalogue sync; `original_available` flips to 1 when an original appears (Photos downloaded it) and the analyzers that used the derivative are **not** re-run (`input_fingerprint` differs but results are valid) — except `exif_full`, which is re-queued so the full tag dump arrives.
- [ ] Housekeeping (§J) refuses trash/delete on `source_kind='apple-photos'` rows with *"Managed by Photos — delete it there"*; hide works.
- [ ] Ignore rules: never descend into `database/`, `scopes/`, `private/`, `resources/` except `derivatives/`.
- [ ] Permission failures mid-scan (`EPERM`) mark the run with a clear error and the Settings card explains the fix (reuses the analysis "last error" plumbing).
- [ ] Tests for each rail.

---

### Task 9 (optional, desktop app only): PhotoKit helper for "Download original"

**Files:** `desktop/helpers/memorylane-photokit/` (Swift package: `PHAsset.fetchAssets(withLocalIdentifiers:)`, `PHAssetResourceManager.requestData` with `isNetworkAccessAllowed = true`, writes to a given path, exit codes for denied/not found/network), `desktop/forge.config.ts` (sign the helper like `node-runtime`), server route `POST /api/plugins/apple-photos/download-original { mediaId, keep: boolean }`.

- [ ] Stream mode: helper writes to `<data>/transcoding/photokit/<uuid>.<ext>`, the server serves it for the current viewer/export session and deletes it after (or on restart); `keep=true` moves it to `<data>/originals-cache/` and records `cached_original_path` in `apple_photos_assets` (open decision 8 — default stream).
- [ ] Availability: the server checks for the helper binary at startup (`paths.helpersDir`); the Viewer button appears only when present; plain `npm start` users get "Open in Photos" only.
- [ ] Tests: helper contract test on a machine with a Photos library (manual checklist item), server route unit-tested against a fake helper script.

---

### Task 10: Docs and verification

- [ ] Playbook: macOS section gains "Apple Photos library" (permission, Optimize Mac Storage behaviour, what needs the desktop app); checklist row 14.
- [ ] `CLAUDE.md`: root kinds seam, apple-photos plugin, "never write inside the package".
- [ ] Manual verification on a Mac with a real library (cannot be automated in CI): add library → scan → counts match Photos' own; favourites/keywords/albums present; a named person from Photos appears with their faces; an optimised asset shows the banner, Open in Photos jumps to it; rescan after Photos downloaded it flips the flag.

## Self-review

§M coverage: detect ✔ (T2), read-only catalogue via osxphotos ✔ (T3), People bootstrap ✔ (T6), albums/favourites/keywords ✔ (T4, with §K fallback), iCloud state + viewer actions ✔ (T5, T7, T9), permission handling ✔ (T2, T8), Windows hidden ✔ (constraints). Seams introduced: scan-root kinds (T1) — reusable by future importers (Lightroom catalogues, Google Takeout). Placeholders: none; osxphotos field names are from its documented `PhotoInfo` API and must be confirmed against the installed version in T3 before T4's mapping is finalised.
