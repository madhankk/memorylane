# MemoryLane — Engineering Plan (v1)

> "Reconnect with the memories already sitting in your photo archive."

Scale assumption for defaults below: **50k–300k files**, mostly photos (JPEG + RAW), some video, multi-TB, hosted on a Windows NAS. ExifTool/ffmpeg availability on the host is unconfirmed → design must detect and degrade gracefully.

---

## 1. Architecture

Two repos, both local-only for now (no remote push):

- `memorylane-server/` — Node.js + TypeScript + Fastify. Owns filesystem access, SQLite, auth, scanning, thumbnails, scheduling, all APIs.
- `memorylane-ui/` — React + TypeScript + Vite + React Router. Talks only to the server's REST API. Built output gets copied into the server's `public/` for production so **one process** serves API + static assets.

A `shared` folder (published as a small package or just duplicated types via a build step) holds API DTOs/enums so client and server don't drift. Given "avoid excessive abstraction," start with a `shared/` folder inside `memorylane-server` that the client imports via a relative path or workspace link — not a published npm package.

No Electron in v1; structure keeps the server standalone-launchable so an Electron shell could later just spawn it and point a window at `http://127.0.0.1:<port>`.

## 2. Repository structure

```
memorylane-server/
  src/
    api/            fastify routes (auth, settings, scan-roots, scans, folders, media, search, memories)
    auth/           session + password hashing
    db/             migrations, schema, queries
    scanner/        filesystem walk, incremental diff, scheduler
    media/          thumbnail pipeline, exiftool wrapper, ffprobe/ffmpeg wrapper
    shared/         DTOs, enums, validation schemas (zod)
    app.ts, server.ts
  public/           built client assets (production)
  data/             (dev-only; prod uses OS app-data dir) sqlite + thumbnails + logs
  migrations/
  test/
  package.json

memorylane-ui/
  src/
    pages/          Home, Browse, Folder, Search, SurpriseMe/Viewer, Settings, Login, Setup
    components/
    api/            typed fetch client
    hooks/
  package.json
```

## 3. Database schema (SQLite, better-sqlite3 + migrations)

Core v1 tables:

```
users            (id, username, password_hash, created_at)
sessions         (id, user_id, expires_at, created_at)
settings         (key, value)                       -- singleton k/v: port, bind addr, scan interval, etc.
scan_roots       (id, path, enabled, created_at, updated_at)
folders          (id, scan_root_id, parent_id, name, absolute_path, created_at, updated_at)
media            (id, parent_folder_id, scan_root_id, absolute_path, filename, extension,
                  media_type,            -- 'image' | 'raw' | 'video'
                  file_size, fs_created_at, fs_modified_at,
                  indexed_at, last_seen_at,
                  width, height, orientation, captured_date,
                  fingerprint,           -- hash of (size + mtime) for change detection
                  thumbnail_status,      -- 'pending' | 'done' | 'failed' | 'unsupported'
                  status,                -- 'active' | 'missing'  (soft-delete on scan)
                  -- photo EXIF
                  camera_make, camera_model, lens_model, focal_length, aperture,
                  shutter_speed, iso, rating, gps_lat, gps_lon,
                  -- video
                  duration_seconds, codec)
scan_runs        (id, started_at, finished_at, status, files_scanned, files_new,
                  files_changed, files_removed, error_count, trigger)  -- trigger: manual|scheduled
```

Deferred but schema-compatible (not built in v1, just don't block them):
- `assets` (groups multiple files — RAW+JPEG pairs — into one logical photo)
- `memory_history` (media_id, shown_at, source) for "Forgotten Photos"
- `tags`, `people`

Indexes: `folders(parent_id)`, `folders(scan_root_id)`, `media(parent_folder_id)`, `media(absolute_path)` unique, `media(filename)`, `media(media_type)`, `media(captured_date)`, `media(fs_modified_at)`, `media(status)`.

FTS5 virtual table `media_fts` (filename, absolute_path, camera_make, camera_model, lens_model) synced via triggers, plus a `folders_fts` for folder names — search hits both.

Migrations: plain numbered `.sql` files run by a small hand-rolled runner (or `better-sqlite3-migrate`-style approach) — avoid pulling in a heavy ORM. Decision: **no ORM**, raw SQL + typed query helpers, migrations tracked in a `schema_migrations` table.

## 4. Key libraries

- Fastify, `@fastify/cookie`, `@fastify/session` (or a minimal hand-rolled server-side session store in SQLite — simpler, one less dependency) for auth
- `better-sqlite3` (sync, fast, ideal for this access pattern)
- `sharp` for resizing/orientation
- `exiftool-vendored` (wraps ExifTool, handles the "keep exiftool process alive" perf problem, has a bundled binary option — solves the deployment-strategy question directly)
- `ffprobe-static` / `ffmpeg-static` if licensing/size is acceptable, otherwise detect system `ffmpeg`/`ffprobe` on PATH and disable video thumbnails/metadata gracefully if absent
- `argon2` (Argon2id) for password hashing
- `zod` for input validation, shared between client/server via the `shared/` folder
- `p-limit` (or a tiny custom queue) to bound thumbnail-generation concurrency
- Client: React, Vite, React Router, `@tanstack/react-virtual` for virtualized media grids, no heavy state library needed initially (React Query for server-state caching is worth it given polling scan status, search, pagination)

## 5. REST API

As specified in the brief (section 23), essentially unchanged. Notable refinements:

- `GET /api/media/:id/file` and `/thumbnail` — both resolve id → path server-side, verify the path is under an **enabled** scan root, verify existence, then stream (with `Range` support for video and for large originals).
- `GET /api/folders/:id/children` and `/media` — paginated (`?cursor=` or `?offset=&limit=`, default limit ~100).
- `GET /api/memories/random?count=100` — implemented behind a `RandomSelectionService` interface so `ORDER BY RANDOM()` can be swapped for reservoir sampling later without touching the route.
- All mutating/config/media/scan routes require an authenticated session; only `/api/auth/setup` and `/api/auth/login` are reachable unauthenticated (setup route self-disables once a user exists).

## 6. RAW handling pipeline

```
RAW file → exiftool-vendored:
             - reads metadata (camera/lens/exposure/GPS/captured_date)
             - extracts largest embedded preview (JpgFromRaw / PreviewImage / ThumbnailImage,
               picked by whichever tag yields the largest byte size for that make/model)
           → Sharp: resize preview to thumbnail target, fix orientation
           → write to thumbnail cache, mark thumbnail_status='done'

If no usable embedded preview:
           → thumbnail_status='unsupported', serve a generic RAW placeholder icon in the UI
           → metadata extraction still proceeds independently (never blocks on preview failure)
           → scan continues; failure is logged and counted, not fatal
```

No full RAW demosaic/render in v1 (no `libraw`/`dcraw` dependency) — this is the main reason RAW indexing stays fast at this scale. Revisit only if embedded-preview coverage proves poor across the user's actual camera set.

## 7. Scan/index pipeline

- Streaming directory walk (`fs.opendir`, recursive, no full-tree-in-memory), per scan root, one root at a time by default (configurable concurrency later if profiling justifies it).
- Fingerprint = `size + mtime` (no content hashing by default, per spec) compared against the stored `media` row; unchanged → skip entirely (not even re-stat metadata).
- New file → insert `media` row (`thumbnail_status='pending'`), enqueue metadata+thumbnail job.
- Changed file (size/mtime differ) → update row, re-enqueue metadata+thumbnail.
- Files present in DB but not seen this walk → marked `status='missing'` (not hard-deleted, so history/thumbnails aren't lost on a transient unmounted drive — a NAS-relevant concern). A future cleanup job can hard-delete `missing` rows older than N days.
- Folder records created/updated to mirror directory structure; empty/missing folders marked accordingly.
- Metadata+thumbnail work runs off the main scan-walk loop via a bounded queue (`p-limit`, default concurrency ~4, tunable) so the walk itself stays fast and the event loop isn't blocked by Sharp/ExifTool calls.
- Batched SQLite writes inside transactions (e.g., commit every N files) instead of one transaction per file.
- One `scan_runs` row per run; a simple in-memory (or DB-backed) lock flag prevents concurrent scans; scheduler checks on startup whether the configured interval has elapsed and queues the next run.

## 8. Thumbnail pipeline

- Standard images: Sharp resize direct from source, EXIF-orientation-aware, long edge ~500px, JPEG output (quality ~80). **Decision: JPEG over WebP for v1** — universal `<img>` compatibility, simplicity; revisit if disk footprint becomes an issue at 300k files.
- RAW: via embedded preview as above, then same Sharp resize step.
- Video: `ffmpeg -ss <midpoint> -frames:v 1` grab a frame (only if ffmpeg detected), then same Sharp resize; if ffmpeg missing, a static generic video-file icon is served instead — never blocks scanning.
- Filenames: `<media_id>.jpg` under `<data-dir>/thumbnails/`, flat directory sharded into subfolders by id range (e.g. `thumbnails/00/01/1234.jpg`) once file counts get large, to avoid NTFS/ext4 single-directory slowdown at 100k+ entries.
- Regeneration only when `thumbnail_status != 'done'` or source fingerprint changed.

## 9. Authentication design

- Single admin user, `users` table, Argon2id hash.
- Server-side sessions stored in a `sessions` SQLite table (no Redis — unnecessary at this scale), session id in an HTTP-only, `SameSite=Lax`, `Secure`-when-not-127.0.0.1 cookie.
- Fixed expiration (e.g., 7 days sliding) enforced on each request; logout deletes the session row.
- First-run: `POST /api/auth/setup` only works while `users` table is empty; on success, the session is explicitly cleared and the client is redirected to `/login` (per spec — deliberate re-login after setup).
- CSRF: since the API is same-origin (server serves the built client) and cookies are `SameSite=Lax`/HttpOnly, add a lightweight double-submit CSRF token on state-changing requests as defense-in-depth.

## 10. Cross-platform approach

- All paths handled via Node's `path`/`fs` (`path.resolve`, `path.sep`-agnostic joins) — never manual string concatenation.
- App-data directory resolved per-OS at startup (`%LOCALAPPDATA%\MemoryLane`, `~/Library/Application Support/MemoryLane`, `~/.local/share/MemoryLane`), created if missing.
- Scan roots stored as absolute paths as the OS provides them; UNC paths (`\\nas\photos`) supported as-is on Windows since the app itself will typically run on the NAS.
- ExifTool/ffmpeg: detect at startup via a `which`-style PATH probe + a configurable explicit-path override in Settings; log clearly what was found/missing; missing ffmpeg only disables video thumbnails/metadata, missing ExifTool falls back to Sharp's own (more limited) metadata for standard images and disables RAW metadata/preview extraction (RAW files still get indexed as files, just with degraded metadata and a placeholder thumbnail) — image browsing itself is never blocked.

## 11. Implementation phases

Following the brief's phases 1–7 as-is. No changes proposed.

## 12. Key risks / unresolved decisions

- **ExifTool/ffmpeg presence unconfirmed on the NAS.** Mitigated by `exiftool-vendored` (can bundle its own binary) and graceful ffmpeg detection; confirm once the box is accessible.
- **RAW embedded-preview coverage varies by camera make/model** — some older RAFs/CR2s may lack a large enough preview; placeholder fallback covers this but worth spot-checking against the user's actual camera set once real files are available.
- **NTFS performance at 100k+ files in one thumbnail directory** — addressed via sharding, but worth validating early rather than late.
- **UNC/network-path scan roots** if the NAS shares are mounted rather than local — should work via Node fs but worth an explicit test since permission/latency behavior differs from local disks.
- **Random-selection quality at scale** — `ORDER BY RANDOM()` on 300k rows is fine performance-wise on SQLite but not verified yet on this exact hardware; isolated behind `RandomSelectionService` so it's a one-file change if it needs to become reservoir sampling.
- **No remote git hosting yet** — repos will be local-only `git init`; revisit if/when the user wants backup or multi-machine access to the codebase.

---

**Next step (pending your go-ahead):** scaffold Phase 1 — monorepo-equivalent two-repo layout, Fastify server skeleton, SQLite migrations for `users`/`sessions`/`settings`, first-run setup + login/logout, Vite React app skeleton, and production static serving wired end-to-end.
