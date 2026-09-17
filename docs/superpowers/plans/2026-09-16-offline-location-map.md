# Offline Location Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline, interactive location heatmap with year and source filters, including Apple Photos catalog-only coordinates, behind a consolidated Library menu.

**Architecture:** A server-side location repository reads filesystem media and Apple catalog assets as one deduplicated point stream, then groups filtered points into viewport cells. Authenticated routes expose a summary, cells, and paginated cell contents. A client SVG map draws a bundled Natural Earth outline and the cells; a year histogram filters the same API data. The Library menu keeps secondary pages reachable without crowding the header.

**Tech Stack:** TypeScript, better-sqlite3, Fastify, React, SVG, Vitest; no map service or runtime network calls.

**Spec:** `docs/superpowers/specs/2026-09-16-offline-location-map-design.md`

## Global Constraints

- Apple Photos access remains read-only toward `.photoslibrary` and disabled libraries never appear in map APIs.
- One Apple Photos asset UUID in one library contributes at most one map point, including catalog-only assets.
- Catalog GPS/date wins for Apple assets when present; linked media is the fallback.
- Map data and the bundled Natural Earth outline load locally; no runtime tile or geocoding request.
- Existing routes and deep links stay available after header navigation changes.
- Date range endpoints are inclusive; unknown-date points appear only with an unfiltered range.

---

### Task 1: Location point source and cells

**Files:**
- Create: `server/src/locations/location-repo.ts`
- Create: `server/src/locations/location-grid.ts`
- Test: `server/test/locations/location-repo.test.ts`
- Test: `server/test/locations/location-grid.test.ts`
- Modify: `server/migrations/034_location_indexes.sql`

**Interfaces:**
- `LocationFilters = { source: "all" | "filesystem" | "apple"; fromYear?: number; toYear?: number }`.
- `LocationPoint = { key: string; source: "filesystem" | "apple"; mediaId: number | null; rootId: number | null; uuid: string | null; date: string | null; lat: number; lon: number }`.
- `LocationRepo.points(filters, bounds?)` synchronously yields visible, valid points; `summary(filters)` returns total, source counts, and year counts.
- `cellKey(lat, lon, zoom)` returns `"zoom:x:y"`; `cells(points, zoom)` returns count and geographic center per key.

- [ ] **Step 1: Write failing source tests.** Seed one ordinary media row with GPS, one linked Apple asset with both catalog and media GPS, one catalog-only Apple asset, an invalid coordinate, a marked media row, a hidden Apple asset, and a disabled Apple plugin. Assert catalog precedence, UUID deduplication, coordinate rejection, and visibility. Reuse `createTestDb`, `seedMedia`, and the existing Apple asset fixture pattern in `server/test/apple-photos/sync.test.ts`.
- [ ] **Step 2: Run** `cd server && npx vitest run test/locations/location-repo.test.ts`; verify failure because `LocationRepo` is absent.
- [ ] **Step 3: Implement** the two source queries in `LocationRepo`: ordinary media rows exclude Apple source, missing media, marked rows, Live Photo video companions, and paired RAW companions; Apple rows come from `apple_photos_assets` joined to enabled Apple roots and optional active media, excluding hidden/trash/marked rows and checking plugin enablement. Resolve each Apple point as `COALESCE(catalog_gps_lat, media.gps_lat)` with the matching longitude and catalog-first date. Validate both coordinate members together and apply source/date/bounds filters. Keep each synchronous iterator inside the synchronous repository call so no SQLite cursor crosses an `await`.
- [ ] **Step 4: Write failing grid tests** for the same point mapping to the same key, zoom splitting nearby points, stable centroids, latitude clamp, and longitude near the antimeridian. Run `cd server && npx vitest run test/locations/location-grid.test.ts` and verify the expected failure.
- [ ] **Step 5: Implement** Web Mercator cell keys with `n = 32 * 2 ** zoom`, `x = floor(((lon + 180) / 360) * n)`, and `y = floor(((1 - asinh(tan(latRadians)) / PI) / 2) * n)` after clamping latitude to ±85.05112878. Group points into a `Map<string, {count,sumLat,sumLon}>`, returning bounded cells. Add partial/location indexes to migration 034 for media GPS and Apple catalog GPS.
- [ ] **Step 6: Run** both location suites and `npm run typecheck --workspace=server`; commit only Task 1 files.

### Task 2: Authenticated location API and shared types

**Files:**
- Modify: `shared/src/types.ts`
- Create: `server/src/api/location-routes.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/api/mappers.ts` only if the existing `toMediaDto` cannot be reused directly
- Test: `server/test/api/location-routes.test.ts`

**Interfaces:**
- `GET /api/locations/summary?source=&fromYear=&toYear=` returns `{total, sources, years, undated}`.
- `GET /api/locations/cells?source=&fromYear=&toYear=&west=&east=&south=&north=&zoom=` returns `{total, items: LocationCellDto[]}`.
- `GET /api/locations/cells/:key/items?source=&fromYear=&toYear=&offset=&limit=` returns `{total, offset, limit, items: LocationItemDto[]}` where each item is either `{kind:"media", media: MediaDto}` or `{kind:"apple-catalog", rootId, uuid, filename, date}`.

- [ ] **Step 1: Write failing API tests** using `createTestApp`: unauthenticated requests return 401; malformed coordinate/zoom/year ranges return 400; summary, cells, and cell items agree on counts; a catalog-only result contains a UUID and no fake `MediaDto`; plugin disable removes Apple results.
- [ ] **Step 2: Run** `cd server && npx vitest run test/api/location-routes.test.ts`; verify route absence or response mismatch.
- [ ] **Step 3: Add DTOs** in `shared/src/types.ts` and validate query parameters in `location-routes.ts` with Zod (`zoom` integer 0–10, years 1800–2100, `limit` 1–100, valid latitude/longitude bounds, `fromYear <= toYear`). Bind the route to `LocationRepo`; use the existing media mapper and `decorateMedia` for linked items. Cell item pagination must use the same key and filters as cell aggregation.
- [ ] **Step 4: Run** the API suite, `npm run typecheck --workspace=server`, and `npm run typecheck --workspace=client`; commit Task 2 files.

### Task 3: Offline map page and interactive time filter

**Files:**
- Add: `client/src/assets/ne_110m_land.geojson` from the Natural Earth 1:110m public-domain land dataset
- Add: `client/src/pages/LocationsPage.tsx`
- Add: `client/src/utils/location-map.ts`
- Add: `client/src/utils/location-map.test.ts`
- Modify: `client/src/api/client.ts`
- Modify: `client/src/App.tsx`

**Interfaces:**
- `api.locations.summary(filters)`, `.cells(filters,bounds,zoom)`, and `.items(key,filters,offset,limit)` match Task 2 DTOs.
- `project(lon,lat)` and `unproject(x,y)` map between geographic coordinates and a 1000×1000 Mercator SVG world.

- [ ] **Step 1: Write failing projection tests** for `(0,0) → (500,500)`, date-filter serialization, inverse projection, and latitude clamp; run `cd client && npx vitest run src/utils/location-map.test.ts` and verify failure.
- [ ] **Step 2: Implement** pure projection/viewport helpers and the typed API client calls. Fetch Natural Earth's 1:110m land GeoJSON from its maintained source repository during development; commit the asset and its public-domain source note so production never fetches it.
- [ ] **Step 3: Build** `LocationsPage`: SVG land outline, wheel/button/keyboard zoom, pointer drag pan, responsive sizing, count-weighted circles, hover/focus labels, density legend, loading/error/empty states, and a results panel with paginated local media versus catalog-only Apple entries. Debounce viewport requests and discard stale responses after a filter/pan change.
- [ ] **Step 4: Add** a year histogram and inclusive two-handle year range control. Fetch the summary once per source filter; update cells when year endpoints change; show unfiltered/unknown-date counts and a clear action. Add source chips for All, Folders, and Apple Photos.
- [ ] **Step 5: Run** the projection tests and `npm run build --workspace=client`; manually verify pan/zoom, year filtering, cell selection, local Viewer access, and Open in Photos for catalog-only entries; commit Task 3 files.

### Task 4: Consolidated Library navigation and complete verification

**Files:**
- Modify: `client/src/components/Layout.tsx`

**Interfaces:**
- Top-level links are Browse, Favorites, Library, Settings, and Search.
- Library contains Locations, People, Tags, Reports, and Cleanup; existing route paths stay unchanged.

- [ ] **Step 1: Verify the current navigation behavior** manually. The new behavior to exercise after implementation is open/close by keyboard, tab reachability, active item indication, and closing after route navigation.
- [ ] **Step 2: Implement** a semantic Library menu using a button and menu links, with outside-click/Escape closure and narrow-width layout. Keep the `/locations` route added in Task 3 and preserve every old route.
- [ ] **Step 3: Run** `npm test --workspace=server`, `npm run build --workspace=server`, `npm run build --workspace=client`, `npx vitest run client/src`, and `git diff --check`; verify the built client has no external map URL and the server migrations copy successfully.
- [ ] **Step 4: Review** the diff for accidental changes to the user's existing cleanup/tag work, then commit only Task 4 files.
