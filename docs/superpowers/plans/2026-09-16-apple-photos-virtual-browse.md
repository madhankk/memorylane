# Apple Photos Virtual Browse and Catalog Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse Apple Photos by virtual year/month without changing imported files, retain GPS for catalog-only items, and offer a way to open/check local availability.

**Architecture:** Persist Photos catalog GPS alongside the existing catalog date and UUID. Query the Apple asset table for grouped virtual navigation and paged items, joining indexed media only when available. Keep Photos launch and local availability checks separate: opening an item never implies a download completed.

**Tech Stack:** SQLite migrations, Fastify, React, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-apple-photos-plugin-design.md`, extended by the September 16 discussion on virtual navigation and catalog-only GPS.

**Implementation status:** Code, automated tests, typecheck, and production build completed in this worktree. Manual browser validation against a running macOS Photos library remains to be done.

## Global Constraints

- Apple Photos remains opt-in and inactive on Windows.
- No modifications to the Photos library or virtual folders persisted in MemoryLane.
- Disabled plugin must block every Apple-specific browse and open endpoint.
- Preview-only indexed items retain normal EXIF, fingerprint, embedding, and face-analysis eligibility.
- iCloud download is not promised; availability is verified after Photos makes a local file accessible.

---

### Task 1: Catalog-only location persistence

**Files:** `server/migrations/029_apple_photos_catalog_gps.sql`, `server/src/plugins/apple-photos/sync.ts`, `server/test/apple-photos/sync.test.ts`.

**Interfaces:** `apple_photos_assets.catalog_gps_lat`, `catalog_gps_lon`; existing `upsertAppleAsset` consumes `AppleCatalogAsset.latitude/longitude`.

- [x] Extend the unavailable-asset test to assert catalog GPS and re-sync updates.
- [x] Run that test and confirm failure due to absent columns.
- [x] Add the migration and write coordinates during every catalog upsert.
- [x] Run targeted tests, then the migration test.

### Task 2: Virtual year/month and item queries

**Files:** `server/src/plugins/apple-photos/browse.ts`, `server/src/plugins/plugin-routes.ts`, `server/test/apple-photos/browse.test.ts`, `shared/src/types.ts`.

**Interfaces:** authenticated `GET /api/plugins/apple-photos/roots/:id/browse` with `year`, `month`, `offset`, `limit`; typed response includes group counts, available/unknown status, and optional `MediaDto`.

- [x] Write a failing query test with dated, unknown-date, catalog-only, and hidden assets; route test covers disabled access.
- [x] Run targeted test to confirm failure.
- [x] Implement root-scoped SQL grouping and paginated item query, using catalog date for unavailable assets and indexed captured date for available items.
- [x] Add route validation and enabled-root checks; run targeted tests.

### Task 3: Virtual navigation UI and library label

**Files:** `client/src/pages/ApplePhotosPage.tsx`, `client/src/App.tsx`, `client/src/api/client.ts`, `client/src/pages/HomePage.tsx`, `client/src/components/FolderCard.tsx`, client tests.

**Interfaces:** Home Apple card navigates to `/apple-photos/:id`; browse API drives Library → Year → Month and All Photos/Unknown Date, with paged media tiles and catalog-only placeholders.

- [x] Write failing component tests for the Apple label and catalog-only placeholder; server test covers group navigation data.
- [x] Run tests and verify expected failures.
- [x] Implement route, card, page, and API client using only virtual queries.
- [x] Run client tests and typecheck.

### Task 4: Open catalog-only item and check local copy

**Files:** `server/src/plugins/plugin-routes.ts`, `server/src/plugins/apple-photos/open-in-photos.ts`, `client/src/pages/ApplePhotosPage.tsx`, server/client tests.

**Interfaces:** Open action accepts root ID + catalog UUID with ownership checks; check action re-reads that UUID through helper and processes it if a suitable local original/preview appears.

- [x] Test disabled-root denial and availability check without a local file; existing open action has its own test.
- [x] Run failing catalog lookup test.
- [x] Implement scoped endpoints and UI actions; do not claim download completion on Photos launch.
- [x] Run targeted tests and full build.

### Task 5: Verify and document

**Files:** `docs/superpowers/specs/2026-09-16-apple-photos-plugin-design.md`, `docs/deployment-playbook.md` if flow instructions need amendment.

- [x] Update the design with preview-only versus catalog-only behavior and local check semantics.
- [x] Run `npm run typecheck`, targeted tests, `npm run build`, and inspect diff.
- [x] Report any manual browser/macOS test limitations explicitly.

### Task 6: Analysis catch-up during direct Apple sync

**Files:** `server/src/plugins/apple-photos/sync.ts`, `server/src/plugins/plugin-routes.ts`, `server/test/apple-photos/sync.test.ts`.

**Interfaces:** `shouldKickAppleAnalysis(processed)` returns true every 250 processed catalog entries; route calls `analysisWorker.kick()` at that cadence and at completion.

- [x] Write and run a failing cadence test.
- [x] Implement bounded kicks during direct Apple sync.
- [x] Keep ordinary-folder scan pausing unchanged and document the distinction.
