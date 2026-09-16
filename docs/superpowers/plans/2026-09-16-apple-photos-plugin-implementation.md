# Apple Photos Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an optional, local Apple Photos importer that is inert when disabled and never writes to a Photos library.

**Architecture:** A persisted plugin switch gates a dedicated scan-root kind and every media read path. A dedicated loopback Python helper reads the Photos catalogue and streams bounded records; the Node server owns the durable index and media processing. The client exposes lifecycle and sync controls under Settings → Plugins.

**Tech Stack:** Fastify, SQLite, TypeScript/React, Python 3, `osxphotos`, Vitest, Python unittest.

**Spec:** `docs/superpowers/specs/2026-09-16-apple-photos-plugin-design.md`

**Implementation checkpoint (2026-09-16):** The plugin lifecycle, dedicated helper, catalogue sync, visibility/analysis gates, People suggestions, and Settings/Viewer controls are implemented on `feature/apple-photos`. Automated server, client, helper, typecheck, and build verification has run; a smoke test against a real Photos library and macOS Automation prompt is still outstanding. `osxphotos.PhotosDB.photos()` returns a complete list by API contract, so the helper maps responses page-by-page but retains that source list in memory during a sync. Stop the dedicated helper after disabling the plugin to release it.

## Global Constraints

- Apple Photos is shipped but disabled by default; disabled cold starts do not import or start its implementation or Python dependencies.
- The helper is dedicated to Apple Photos and never shares the AI sidecar.
- Neither process writes inside a `.photoslibrary` package.
- Disabling stops sync at an asset boundary and gates all Apple media access; indexed data remains for re-enable.
- macOS only for enable/sync; Windows and Linux list the plugin as unavailable.
- Migrations start at `023`; existing `021` and `022` are occupied.
- Apple albums and PhotoKit download-original are deferred by the approved first-release design.

## File map

- `server/migrations/023_plugin_and_apple_photos.sql`: plugin state, root kind, Apple asset provenance.
- `server/src/plugins/registry.ts` and `server/src/plugins/plugin-routes.ts`: cheap manifest and lifecycle switch.
- `server/src/plugins/apple-photos/`: path validation, helper client, sync service, Apple routes and metadata mapping.
- `photos-helper/`: dedicated Python launcher, catalogue reader, authenticated loopback API, tests.
- `server/src/scanner/scanner-service.ts`: exclude packages from generic folder walk; dispatch Apple roots to sync.
- `server/src/query/media-query.ts` and direct media routes/services: centralized active-source visibility.
- `shared/src/{types,validation}.ts`, `client/src/api/client.ts`, `client/src/pages/SettingsPage.tsx`, `client/src/components/Viewer.tsx`: API contracts and UI.
- `docs/deployment-playbook.md`: setup, permissions, helper lifecycle, manual smoke checklist.

---

### Task 1: Plugin state and scan-root kind

**Files:** Create migration `023_plugin_and_apple_photos.sql`, `server/src/plugins/registry.ts`, `server/src/plugins/plugin-routes.ts`, `server/test/api/plugin-routes.test.ts`; modify `server/src/app.ts`, `server/src/api/scan-roots-routes.ts`, shared types/validation.

**Interfaces:** `isApplePhotosEnabled(db): boolean`; `GET /api/plugins`; `PUT /api/plugins/apple-photos` with `{enabled:boolean}`; `ScanRootDto.kind`.

- [x] Write a route test that GET lists Apple Photos as disabled, rejects enabling off macOS, persists enabling on macOS, and distinguishes Apple roots. A wrong default or missing platform guard must fail it.
- [x] Run `npm run test --workspace=server -- plugin-routes.test.ts`; confirm the missing route/schema causes failure.
- [x] Add a migration with `plugin_settings(id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0)`, `scan_roots.kind TEXT NOT NULL DEFAULT 'folder'`, `media.source_kind`, and `apple_photos_assets` keyed by `(scan_root_id, uuid)`. Implement the API with an explicit allowlist and `process.platform` gate. Example state query: `SELECT enabled FROM plugin_settings WHERE id = 'apple-photos'`.
- [x] Run the targeted test, server typecheck, and migration test; commit the slice.

### Task 2: Generic scanner safety and Apple-root dispatch

**Files:** Modify `server/src/scanner/scanner-service.ts`; create `server/test/scanner/apple-root-safety.test.ts`.

**Interfaces:** Folder walk skips directory entries whose names end in `.photoslibrary` case-insensitively. An Apple root is never walked by the generic scanner; sync is delegated to a lazily loaded service only when enabled.

- [x] Write tests with a parent folder containing `Library.photoslibrary/originals/a.jpg`; assert the folder scan never indexes it. Add an Apple root and assert disabled scan never descends into the package.
- [x] Run the targeted test and observe the unexpected media row or descent.
- [x] Add the directory guard before `getOrCreateFolder`; branch on root kind before `walkDirectory`. Do not mark Apple media missing when sync is skipped or fails.
- [x] Run targeted and full server tests; commit.

### Task 3: Dedicated authenticated catalogue helper

**Files:** Create `photos-helper/pyproject.toml`, `photos-helper/memorylane_photos/{__init__,server,catalog}.py`, `photos-helper/tests/test_server.py`, root package script `photos-helper`, and launcher script.

**Interfaces:** `GET /health` and `POST /catalog` on loopback; request header `X-MemoryLane-Token`; response is bounded batches of UUID, original/derivative paths and Photos metadata. Python imports `osxphotos` only inside a catalog request.

- [ ] Write Python tests for unauthenticated rejection, malformed package rejection, bounded pagination/streaming from a fixture adapter, and no writes to fixture package.
- [x] Run `PYTHONPATH=photos-helper python3 -m unittest discover -s photos-helper/tests -v` and confirm failure from the absent implementation.
- [ ] Implement the minimal helper. Read a SQLite-safe catalogue snapshot through `osxphotos`; map documented `PhotoInfo` fields to JSON. Use `Path.resolve()` and reject paths without the `.photoslibrary` suffix. The launcher creates a helper-only venv on first use; it never imports the AI sidecar.
- [ ] Run helper tests and an authenticated `GET /health`; commit.

### Task 4: Catalogue sync and stable media rows

**Files:** Create `server/src/plugins/apple-photos/{helper-client,sync,mapping}.ts`, tests under `server/test/apple-photos/`; extend migration if needed.

**Interfaces:** `syncAppleRoot(db, paths, rootId, signal)` fetches batches and upserts one media row per `(rootId, uuid)`; unavailable assets retain provenance but have no usable media row. Original path wins over preview; a derivative is never indexed independently.

- [ ] Write table-driven tests for local original, preview-only, unavailable asset, duplicate UUID resync, interrupted sync, and permission failure preserving existing index.
- [ ] Run targeted tests and confirm failures.
- [ ] Validate helper records at the trust boundary. Use a transaction per bounded batch and check the enabled bit before each asset. Store provenance, display filename, availability, keywords/faces, last sync state in MemoryLane tables. Queue normal thumbnail/analysis work for new or changed media only.
- [ ] Run targeted and full server tests; commit.

### Task 5: Visibility, serving, and analysis gates

**Files:** Modify `server/src/query/media-query.ts`, `server/src/api/media-routes.ts`, related lookup/analysis services, and tests.

**Interfaces:** `ACTIVE_MEDIA_SQL` excludes `source_kind='apple-photos'` unless the plugin is enabled. Direct id/file/thumbnail/preview/face-crop routes return 404 while disabled; analysis claims exclude it. Preview-only serves derivative with no persistent cache.

- [ ] Write API tests that create indexed Apple media, disable the plugin, then assert list/search and all direct media URLs cannot reveal bytes or metadata; re-enable restores access.
- [ ] Run targeted tests and confirm leakage before implementation.
- [ ] Add one shared source-visibility clause and use it in query builder, direct resolver, related routes, and analysis claim SQL; avoid scattered client-only checks.
- [ ] Run targeted and full tests; commit.

### Task 6: Metadata and named-person precedence

**Files:** Modify sync mapping, EXIF and People integration; add tests under `server/test/apple-photos/`.

**Interfaces:** Photos metadata fills missing/adjusted fields without overwriting user edits. Named face suggestions apply only to overlapping detected boxes and never override explicit assignments, rejections, or dismissals.

- [ ] Write tests for adjusted dates, filename/location/camera, favourite preservation, hidden/trashed exclusion, and named-face overlap/user-override precedence.
- [ ] Run targeted tests and confirm failing behavior.
- [ ] Implement mapping and People bootstrap using existing repositories; never auto-assign unmatched named faces. Persist catalogue faces for later bootstrap when People detection is off.
- [ ] Run targeted and full tests; commit.

### Task 7: Settings, viewer, and documentation

**Files:** Modify Settings, API client, Viewer, styles, client tests, deployment playbook.

**Interfaces:** Permanent Plugins tab; enabled Apple detail shows helper health, add package path, sync/progress/error/counts, permission guidance and stop command. Disabled Apple media disappear from current view. Viewer labels preview-only and offers Open in Photos; no download-original button.

- [ ] Write UI tests for off/default, unavailable platform, enable/disable confirmation, sync error, and preview-only banner/actions.
- [ ] Run targeted client tests and confirm missing controls.
- [ ] Implement minimal UI using existing Settings/Modal patterns; add server Open in Photos route with UUID escaping and macOS Automation error handling. Document the one-command helper setup and manual macOS checklist.
- [ ] Run client/server typechecks, all tests, production build, helper tests; perform manual fixture smoke test and commit.

## Self-review

Each approved design section maps to Tasks 1–7. Cold-start isolation and lifecycle: 1–3; read-only helper: 3; sync/rescan: 4 and 6; central visibility: 5; UI and docs: 7. Album import and PhotoKit download remain explicitly deferred. The full test suite and a real-library manual checklist are required before claiming first-release completion.
