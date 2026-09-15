# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MemoryLane is a self-hosted, local-first photo/video browser for photographers with large archives. It indexes existing folders **in place** (never renames/moves/modifies originals), builds a disposable SQLite index + thumbnail cache in an OS app-data dir, and surfaces "rediscovery" features (random memory, this-day-another-time, Surprise Me) biased toward photos not seen recently.

The one deliberate exception to "never touch originals" is the opt-in video modernization flow, which only ever *moves* an original into a visible `_MemoryLane-Archived-Originals` sibling folder after the user has reviewed the transcode. Preserve this invariant in any change.

## Commands

npm workspaces monorepo: `shared`, `server`, `client`, `desktop`. Run from the repo root unless noted.

```bash
npm install
npm run build          # shared → client → server (order matters: client emits into server/public)
npm start              # node server/dist/server.js, serves API + built client on :4280
npm run dev            # server only, tsx watch (regenerates server/src/version.ts first)
npm run dev:client     # Vite on :5173, proxies /api → 127.0.0.1:4280 (run alongside `npm run dev`)
npm run typecheck      # tsc --noEmit across shared, server, client
npm test               # vitest, server/test/** (in-memory SQLite; one file: npm test --workspace=server -- test/exif/promote.test.ts)
npm run reset-password -- <args>   # server/scripts/reset-password.ts
```

- `shared` must be built (`npm run build --workspace=shared`) before server/client typecheck resolves `@memorylane/shared` — it's consumed via `dist/`.
- `server/src/version.ts` is generated from `server/package.json` by `scripts/generate-version.mjs` and is gitignored; never edit or commit it.
- Migrations are copied to `server/dist/migrations` at build time; `migrate.ts` resolves whichever of `server/migrations` (dev) or `dist/migrations` (built) exists.
- Set `MEMORYLANE_NO_OPEN=1` to stop the server auto-opening a browser tab (already suppressed under `npm run dev`). `MEMORYLANE_DATA_DIR` relocates the DB/thumbnail cache — useful for a throwaway dev library.

Desktop (Electron tray app) — run from `desktop/`, and only after a root `npm run build`:

```bash
npm run prepare-runtime   # assembles desktop/runtime/ (node binary + server/dist + prod deps); fails loudly if root build is missing
npm run dev               # rebuilds tray app only, NOT the runtime — re-run prepare-runtime after server/shared changes
npm run make              # build + prepare-runtime + electron-forge make → desktop/release/<version>/
```

## Architecture

### Request/data flow

```
client (React SPA) ── fetch /api/* ──▶ Fastify routes (server/src/api/*) ──▶ better-sqlite3 (sync)
                                              │
                    ScannerService ──▶ processMediaItem ──▶ ExifTool / ffmpeg / Sharp ──▶ thumbnails/, previews/
```

- **`server/src/context.ts`** — `AppContext` holds every app-wide singleton (db, paths, sessions, scanner, randomSelection, transcodeWorker). Built once in `server.ts`, passed to each `register*Routes(app, ctx)` in `app.ts`. New routes/services should hang off this rather than importing singletons.
- **DB access is synchronous** (better-sqlite3, WAL mode). Routes and services run prepared statements inline; there's no ORM or repository layer beyond a few thin `*-repo.ts` helpers.
- **`shared/src/types.ts`** holds every DTO the API returns; **`shared/src/validation.ts`** holds the zod schemas for request bodies. Routes parse with `schema.safeParse(request.body)` and map DB rows → DTOs via `server/src/api/mappers.ts`. Adding an API field means touching shared types, the mapper, and the client.
- The client is served as static files from `server/public` with an SPA fallback for non-`/api/` paths; the client bundles its own typed API wrapper in `client/src/api/client.ts`.

### Scanning & media pipeline

- `ScannerService.runScan` walks each enabled `scan_roots` row, upserts `folders`/`media` rows, and detects change via `fingerprint = size:mtime` (deliberately not a content hash). Rows not touched during a run are marked `status='missing'` — but only within the roots that run covered (a single-root scan must never mark other roots missing).
- Thumbnail/metadata work is queued through `p-limit(4)` and flushed in batches of 200 while the walk continues; progress is persisted to `scan_runs` every 2s so the client can poll `/api/scans/status`.
- `processMediaItem` (media-processor.ts) never throws: metadata extraction and thumbnail generation are guarded independently so a Sharp failure doesn't discard EXIF data already read. Outcome lands in `media.thumbnail_status` (`pending|done|failed|unsupported`); anything not `done` is retried on the next scan even if the fingerprint is unchanged.
- **Per-type handling:** standard images → Sharp from file (BMP decoded via bmp-js first, since libvips can't read it); RAW → ExifTool extracts the largest embedded preview, from which both a 500px thumbnail and a 1800px `previews/` tier are produced, oriented by the RAW file's *own* EXIF orientation (embedded previews often lack/lie about theirs); video → ffprobe for codec/duration + one ffmpeg poster frame. Originals are streamed as-is with Range support; there is no on-the-fly transcoding.
- Thumbnails/previews are sharded on disk by media id (`paths.ts`) and served with a 1-year immutable cache header; `media.thumbnail_version` is bumped on every regeneration and appended as a query param by the client to cache-bust.
- `processMediaItem` also writes the full ExifTool tag set to `media_exif` (`server/src/exif/`: `promoteTags` maps ~25 typed columns, the rest goes to `tags_json`) and marks the `exif_full` analyzer done for that row. Note `tags.FocalLength` etc. arrive as strings with units (`"100.0 mm"`) — use `parseLeadingNumber`.

### Analysis pipeline

`server/src/analysis/`: `media_analysis` holds one row per (media, analyzer) with `status`/`model_version`. `AnalysisWorker` (started in `server.ts`, on `AppContext`) polls pending rows per registered `Analyzer` (`registry.ts`), runs batches, and records outcomes; it pauses while a scan runs and is kicked by `scanner.onScanFinished`. On startup it resets `running` → `pending` and re-queues rows whose `model_version` differs from the analyzer's. Adding an analyzer = implement `Analyzer` (`types.ts`) and append it to `createAnalyzers`; bump its `version` to re-run it library-wide. Status/retry: `GET /api/analysis/status`, `POST /api/analysis/retry`.

### Media listing queries

`server/src/query/media-query.ts::buildMediaQuery` is the only place listing WHERE clauses are assembled (scope, type, companion exclusion, favorites, EXIF filters). Every listing route and `random-selection-service` use it; new filters go there, not in routes. Companion fragments are `media.`-qualified.

### Stacks

`server/src/stacks/`: `stacks` / `stack_members` (a photo is in at most one stack) / `stack_exclusions` ("never auto-stack again") / `stack_dirty_folders`; `media_phash` holds a 64-bit DCT hash of the thumbnail as 16 hex chars. `groupBursts` (stacker.ts, pure) does one time-sorted pass per folder: same body (serial, else model) + within `stackGapSeconds` + (hash distance ≤ `stackMaxHamming` **or** same maker-note burst id); cover = first frame. `StackService.recomputeFolder` replaces only `user_modified = 0` stacks, and candidates exclude `stack_exclusions` and members of user-modified stacks — every user operation sets `user_modified = 1`; remove/delete add exclusions, split doesn't. `groupBursts` v2 also accepts embedding cosine ≥ `stackMinCosine` (default 0.9) as "same moment"; `rule_version` mismatch on startup re-queues every folder. Recompute flow: scanner (new/changed/missing), the `phash` analyzer and `embed_image` mark folders dirty → `AnalysisWorker`'s `onIdle` (only when every analyzer is drained and no scan is running) → `recomputeDirty`. `buildMediaQuery({ collapseStacks })` hides non-cover members: on for the folder grid (unless `expandStacks=true`), hero, memories, random selection; off for search, favorites, reports. Every listing route must call `decorateMedia(ctx, dtos)` (favorites + `MediaDto.stack`). Client: stack badge on cover tiles → `StackPanel`; folder "Select" mode → manual stack.

### AI sidecar & embeddings

`memorylane-ai/` (Python, FastAPI, onnxruntime; see its README) serves CLIP ViT-B/32 embeddings at `MEMORYLANE_AI_URL` (default `http://127.0.0.1:4281`). Run it with `cd memorylane-ai && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && .venv/bin/memorylane-ai`; tests: `.venv/bin/pytest -q` (first run downloads ~350 MB). The server side: `providers/` (`createProvider()` from env — `MEMORYLANE_AI_PROVIDER=none` disables everything AI; `SidecarProvider` classifies failures: outages → `ProviderUnavailableError`, 4xx → plain `Error`), `vectors/` (`EmbeddingRepo` over `media_embeddings` = durable truth; `LanceVectorIndex` under `<data>/vectors/` = rebuildable cache, `ensureSynced` on startup; `@lancedb/lancedb` pinned to 0.33.0 for Node 20), `analyzers/embed-image.ts` (embeds the 500 px thumbnail, batch 16, version = model id). `AnalysisWorker` handles `ProviderUnavailableError` by un-claiming rows and backing off 5 s → 5 min per analyzer — never marks them failed. Vectors from different models never mix: the index space is `media:<model>`. Features: `GET /api/media/:id/similar` (works offline once vectors exist), `GET /api/search?mode=semantic` (needs the sidecar for the text embedding), stacks v2 (`stackMinCosine`), faces (see People). Settings › AI shows provider status; `aiEnabled` pauses `embed_image` via `Analyzer.isEnabled`.

### People (faces)

Opt-in (`personsEnabled`, default off — faces are biometric data); every `/api/persons*` and `/api/faces*` route 404s while off, and `DELETE /api/persons/data` wipes rows, the `faces:*` index space and the crop cache. Sidecar: `/v1/faces` (YuNet detector + SFace 128-d, both **Apache-2.0** OpenCV Zoo ONNX files — chosen over InsightFace's non-commercial `buffalo_l`; model id `yunet-sface@1`) and `/v1/cluster` (Chinese whispers, numpy only). Server: `analyzers/faces.ts` renders a 1600 px oriented JPEG (`media/analysis-input.ts`), stores rows via `persons/face-repo.ts` (which carries user assignments/rejections across re-detection by bbox IoU ≥ 0.5) and vectors in `faces:<model>`, then calls `PersonService.assignNewFaces` (kNN among assigned faces ≥ `faceAssignThreshold`, default 0.45, never crossing a rejection). Discovery (`discoverIfNeeded`, from the worker's idle hook) clusters unassigned quality faces (`quality ≥ 0.5`), joins an existing person when the cluster centroid matches, else creates `Person N` (`faceMinClusterSize`, default 3). `assigned_by='user'` is never touched by automation. `buildMediaQuery({ personIds })` powers "photos of X" (+ date range via the EXIF filters). Client: `/people`, `/people/:id`, `FaceChip` (✓ confirm / ✗ not them), Viewer "People:" line.

### Reports

`GET /api/media` (filtered list), `GET /api/reports/facets` (per-field counts, each ignoring its own filter), `GET /api/reports/export.csv` share `exifFilterQuerySchema` in `shared/`. `FOCAL_BUCKETS` in shared defines focal-length ranges used by both server and client. Client page: `client/src/pages/ReportsPage.tsx`; filters live in the URL query string.

### Pairing (Live Photos, RAW+JPEG)

Two "hide the companion" relationships live on `media`:
- `live_photo_video_id` — still ↔ video sharing an EXIF `ContentIdentifier` in the same folder.
- `raw_pair_id` — RAW ↔ image sharing a base filename in the same folder.

Both are linked best-effort from whichever side is processed second. Every media-listing query goes through `buildMediaQuery`, which appends `EXCLUDE_LIVE_PHOTO_VIDEOS` and `EXCLUDE_PAIRED_RAW` by default so companions never appear as their own grid items. `NEEDS_TRANSCODE_SQL_CLAUSE` (video-compatibility.ts) is likewise the single source of truth for "which videos need modernizing" so stats and candidate lists can't drift.

### Rediscovery & engagement

`media_engagement` stores only aggregate counters (favorite, shown_count/last_shown_at, view_count) — intentionally not an event log. `SqliteRandomSelectionService` excludes anything shown in the last 7 days, then tops up from the full pool. Shown/viewed are posted only from full-size viewers (Viewer, InlineSlideshow), never from grids.

### Migrations

Numbered `server/migrations/NNN_*.sql`, applied in filename order on every startup inside individual transactions, tracked in `schema_migrations`. A SQLite online backup (`memorylane.sqlite.pre-migration-*.bak`, last 5 kept) is taken automatically before any pending migration. To add schema: create the next-numbered file; never edit an already-shipped one. If a migration invalidates thumbnails, reset `thumbnail_status` so the next scan regenerates them (see 007/008 for the pattern).

### Auth & file safety

Single-user, cookie sessions (`SessionStore`, 7-day sliding TTL, `secure: false` because the app never serves TLS). Routes gate with `preHandler: app.requireAuth`. Initial setup is loopback-only unless `MEMORYLANE_ALLOW_REMOTE_SETUP=1`. File-serving routes must resolve paths **only from the DB by media id** via `resolveVerifiedMedia` (enabled root, active status, path inside root) — never from request input.

### Video modernization (transcode)

`TranscodeWorker` runs jobs at concurrency 1, encodes into `<data-dir>/transcoding/` (never the library), and only on explicit user Archive copies the result next to the original and moves the original into `_MemoryLane-Archived-Originals` (auto-added to `ignored_paths`). On startup, jobs stuck at `transcoding` are marked failed (not auto-retried, to avoid poison-file loops); `pending` jobs resume.

### Client

React 18 + React Router 6 + Tailwind 4 (Vite plugin). `App.tsx` routes: `/setup`, `/login`, then `Layout`-wrapped `/`, `/folder/:id`, `/search`, `/settings`, `/surprise`, `/favorites`. Context hooks: `useAuth` (setup/login state drives redirects), `useTheme` (light/dark/dusk/gallery, tokens in `styles.css`). `utils/mediaSrc.ts::displaySrc` decides full-size source: RAW → `/preview`, else `/file`, fallback `/thumbnail`.

## Notes

- README.md and several code comments reference `PLAN.md` (spec section numbers); that file is not in the repo. The media-intelligence design lives at `docs/architecture/2026-09-14-media-intelligence-design.md`.
- ExifTool must be on PATH for RAW/metadata; ffmpeg/ffprobe are bundled via `ffmpeg-static`/`ffprobe-static`. Both are detected at startup and degrade gracefully (thumbnail_status `unsupported`) when missing.
- macOS signing/notarization in `desktop/forge.config.ts` is incomplete (runtime binaries need an explicit codesign pass — see the TODO there).
