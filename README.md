# MemoryLane

Self-hosted photo and video browser for rediscovering the memories already sitting in your photo archive.

MemoryLane indexes existing photo folders in place, generates thumbnails, and helps you rediscover old photos through browsing, search, and "Surprise Me" style random rediscovery - all on your own hardware, over your own files. It never renames, moves, or modifies your originals, with one narrow, explicit exception: the opt-in video modernization tool in Settings, which only ever *moves* an original (never deletes it) into a plain, visible folder right next to it, and only after you've reviewed and confirmed the replacement. See [docs/deployment-playbook.md](docs/deployment-playbook.md) to set it up on a Mac or Windows machine, and [docs/architecture/](docs/architecture/) for the design behind the photographer features.

Photos, RAW, video, and Apple Live Photos are all indexed and browsable.

## Features

- **Local-first, self-hosted** - your photos never leave your machine. No cloud upload, no third-party indexing, no subscription.
- **Read-only, filesystem-as-source-of-truth** - MemoryLane only reads your originals. It builds a disposable SQLite index and thumbnail cache alongside them; delete that cache anytime and rescan to rebuild it from scratch.
- **Fast browsing at any library size** - folder tree navigation with infinite scroll, full-text search across folders and files, and per-scan-folder stats (item counts, cache size on disk).
- **Broad RAW support** - every major camera maker's RAW format is indexed with embedded-preview thumbnails and a larger fullscreen preview tier, both correctly oriented from the RAW file's own EXIF: Canon (CR2/CR3/CRAW/CRW), Nikon (NEF/NRW), Sony (ARW/SRF/SR2/ARQ), Fujifilm (RAF), Olympus/OM System (ORF), Panasonic/Lumix (RW2), Pentax (PEF), Samsung (SRW), Sigma (X3F), Minolta (MRW), Kodak (DCR/K25/KDC), Hasselblad (3FR/FFF), Mamiya/Leaf (MEF/MOS), Phase One (IIQ), and Adobe DNG.
- **Video** - indexed with a poster-frame thumbnail and duration badge; click to play the original file directly in the browser's native player (no automatic transcoding - playback works whenever the browser itself can decode the file).
- **Apple Live Photos** - the still and its paired ~3s video are detected automatically and shown as one grid item with a LIVE badge; open it to play the video inline.
- **Video modernization (opt-in)** - Settings flags any video whose codec won't play in a browser (old camera formats like MJPEG, mostly) and lets you transcode it to H.264/AAC, preview the result, then archive the original - which only ever moves it into a plain `_MemoryLane-Archived-Originals` folder next to it, never deletes it. Nothing is touched automatically; every step requires you to review and confirm it.
- **Rediscovery, not just browsing** - a home hero card surfaces a random photo with a subtle "June 2007 · London · 19 years ago" caption, tabbed **Random Memory** / **This Day, Another Time** mini slideshows, and a full "Surprise Me" fullscreen mode.
- **Lightweight, invisible engagement tracking** - a simple favorite star and quiet shown/viewed counters bias rediscovery toward photos you haven't seen in a while, without ever turning into an analytics dashboard.
- **Four themes** - light, dark, dusk, and gallery, switchable at any time.
- **Multi-folder libraries** - scan multiple folders/drives, reorder them, and trigger a rescan of just one folder at a time from Settings.
- **Ignore folders you don't want indexed** - a global ignore list (Settings, or click "Ignore folder" while browsing one) tells the scanner to permanently skip a path - it removes that folder and its already-indexed items from your library without touching the original files.

### For photographers with large archives

- **Full EXIF capture and reports** - every tag ExifTool can read is stored per photo; the important ones (lens, body and serial, aperture, shutter, ISO, focal length, drive mode, rating, keywords, GPS) are indexed. The **Reports** page shows facets for lens / camera / aperture / focal length / ISO / year: click any value to narrow the grid and every other facet, add a date range, and **Export CSV** of the selection. Filters live in the URL, so a report is bookmarkable.
- **Stacks** - bursts collapse to a single tile with a ⧉ count badge. Grouping uses capture time (with sub-second precision), camera body, a perceptual hash of each frame and, when the AI sidecar is running, image similarity - so it also handles tripod and long-exposure series where frames are a minute apart but near-identical. Expand a stack to view it, pick the cover, split it, remove frames or delete it; use **Select** in any folder to stack photos by hand. Anything you edit is never regrouped automatically; thresholds are in Settings › Stacks.
- **Find similar** - open any photo and press ✨ for a ranked grid of the photos that look most like it, across your whole library.
- **Describe-it search** - switch Search to *Describe it (AI)* and type what you're after ("a bird taking off from water", "snow on mountains at dusk") instead of remembering filenames.
- **People (opt-in)** - faces are detected and grouped into people you can name; the **People** page lists them, and a person's page shows their photos (with a date range - "photos of Maya, summer 2019"), plus the faces behind the grouping so you can confirm (✓) or say "not them" (✗). Merge duplicates, hide people you don't care about, and delete all face data in one click. Two face models are available: a default with an open license, and a stronger option for personal libraries where siblings and children are hard to tell apart.
- **Background analysis with progress** - all of the above runs as a resumable queue after each scan (Settings › Analysis shows progress bars, ETAs and any files that couldn't be read). Stop the app mid-way and it carries on where it left off.
- **Storage control** - Settings › Storage shows where the cache and index live and how big each part is, and can move all of it to another disk.

## AI features (optional)

Find similar, describe-it search, image-similarity stacking and People use small local models served by the `memorylane-ai` sidecar (CLIP for image/text vectors, YuNet + SFace or InsightFace ArcFace for faces, all via ONNX Runtime). Nothing leaves your machine: the sidecar never sees your file paths - the server sends it thumbnails and keeps the resulting vectors in its own data directory. It runs on Windows, macOS (Apple Silicon) and Linux; CPU is plenty (about 50 photos/s for embeddings on an M2 Max), GPU optional. Start it with `npm run ai` in a second terminal (Python 3.11+ required, ~350 MB model download on first start); see [memorylane-ai/README.md](memorylane-ai/README.md). Without it, everything else works exactly as before - EXIF reports and time/hash-based stacks need no sidecar.

## Requirements

- Node.js 20+
- [ExifTool](https://exiftool.org/) available on PATH (RAW metadata/preview extraction; standard image browsing still works without it)
- ffmpeg/ffprobe - bundled automatically (via ffmpeg-static/ffprobe-static), no separate install needed; used only to extract a video's poster-frame thumbnail and duration, never to transcode

## Setup

```bash
git clone <this-repo-url>
cd memorylane
npm install
npm run build
npm start
```

Open `http://127.0.0.1:4280`. On first launch you'll be asked to create an admin username and password - there's no default account and no public sign-up, so this is the only way in. After logging in, go to **Settings** and add one or more folders to scan; MemoryLane will index them and start generating thumbnails in the background.

You can change your password anytime from **Settings → Account**. Forgot it instead? There's no email/cloud recovery flow (there's no email, no cloud) - reset it from the machine hosting MemoryLane instead:

```bash
npm run reset-password                          # lists existing usernames
npm run reset-password -- <username> <new-password>
```

This works whether the server is running or stopped, and signs out every existing session for that user.

## Development

```bash
npm install
npm run dev          # starts the Fastify server on :4280
npm run dev:client   # in a second terminal - Vite dev server on :5173 with API proxy
```

Open `http://localhost:5173` during development (the client dev server proxies `/api` to the backend).

## Configuration

MemoryLane is configured entirely through environment variables (no config file):

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEMORYLANE_DATA_DIR` | OS-standard app-data dir | Where the SQLite database, thumbnail cache, and logs are stored |
| `MEMORYLANE_PORT` | `4280` | Port the server listens on |
| `MEMORYLANE_BIND_ADDRESS` | `0.0.0.0` | Bind address - `0.0.0.0` (the default) listens on every network interface, so other devices on your LAN (phone, tablet, another computer) can reach it at `http://<this-machine's-LAN-IP>:4280`. Set to `127.0.0.1` to restrict it to this machine only. |
| `MEMORYLANE_ALLOW_REMOTE_SETUP` | unset (disabled) | Initial admin account setup is restricted to the machine hosting MemoryLane by default - since the server is reachable on your LAN as soon as it starts, this stops someone else on the network from claiming the one admin account before you do. Set to `1` to allow completing setup from another device. |

MemoryLane has no HTTPS/TLS support, so traffic (including your session cookie and the photos themselves) is unencrypted on the network - fine on a trusted home LAN, but don't expose the default `0.0.0.0` bind directly to the internet (e.g. via router port-forwarding) without putting a reverse proxy with real TLS in front of it.

## Data

MemoryLane's database, thumbnail cache, previews, vector index, and logs live in an OS-standard app-data directory (e.g. `%LOCALAPPDATA%\MemoryLane` on Windows) - entirely separate from your photo folders, and safe to delete and rebuild via a rescan at any time. Settings › Storage shows the location and sizes and can move everything to another disk; the `MEMORYLANE_DATA_DIR` environment variable overrides both.

## Upgrading

```bash
git pull
npm install
npm run build
npm start
```

The database schema is versioned via numbered SQL files in `server/migrations/`, tracked in a `schema_migrations` table. Every server start applies any migrations it hasn't seen yet, in order, each in its own transaction - there's no manual DB migration step to run. Before applying any pending migration, the server automatically snapshots the SQLite database to `<data-dir>/memorylane.sqlite.pre-migration-<timestamp>.bak` (keeping the last 5), so a bad upgrade can be rolled back by stopping the server, restoring the most recent `.bak` over `memorylane.sqlite`, and restarting the previous version.

Occasionally a migration needs to invalidate existing thumbnails (e.g. to fix a rendering bug) - when that happens, affected thumbnails simply regenerate the next time a scan runs, with no action needed beyond triggering a scan (automatic on schedule, or manually from Settings).

## Desktop app (Windows/macOS tray installer)

`desktop/` packages MemoryLane as a tray app for non-developers: it manages the server as a background process (start/stop, launch-at-login, a small status window) and needs no separate Node.js install, since it bundles its own copy of the Node runtime rather than requiring one on the target machine.

### Build sequence

```bash
# 1. From the repo root - builds shared, client, and server
npm install
npm run build

# 2. From desktop/ - bundles the tray app, assembles the runtime folder
#    (a copy of node.exe + step 1's server build + its production
#    dependencies - see scripts/prepare-runtime.mjs), and produces a
#    platform installer
cd desktop
npm install
npm run make
```

`npm run make` chains `npm run build` (desktop's own tray app code), `npm run prepare-runtime`, then `electron-forge make`. Step 1 must already have run - `prepare-runtime` fails loudly if `server/dist`, `server/public`, or `shared/dist` don't exist yet, rather than silently packaging a stale or empty runtime.

Output lands in `desktop/release/<version>/`:
- Packaged app: `MemoryLane-win32-x64/` (Windows) or the `.app` (macOS)
- Installer: `make/squirrel.windows/x64/MemoryLane-Setup.exe` (Windows) or `MemoryLane-<arch>.dmg` (macOS)

Use `npm run package` instead of `make` to produce just the packaged app folder without an installer (useful for a quick sanity check without waiting on Squirrel/DMG packaging).

### Signing a real release

```powershell
$env:SIGN_RELEASE = "1"
npm run make
```

Both `memorylane-desktop.exe` **and** `node-runtime.exe` get signed (the latter is spawned as its own process, not a library loaded by the already-signed app, so it needs an independent signature or Windows SmartScreen flags it on its own), plus the `MemoryLane-Setup.exe` installer itself - see `desktop/forge.config.ts` and `desktop/scripts/sign-*.ps1`. This requires Windows code-signing infrastructure already set up on the build machine (Azure Trusted Signing via `signtool`, pointed at `C:\codesigning\metadata.json`). Without `SIGN_RELEASE=1`, `make` still produces a working installer, just unsigned - fine for local testing, but Windows will show a SmartScreen warning and macOS will block launch outright without a signed, notarized build.

macOS signing/notarization is wired up in `forge.config.ts` too, but is **not yet complete**: the automatic `osxSign` pass signs the `.app` bundle's own code, but `runtime/`'s own binaries (`node-runtime.exe`, and the native `.node`/`dylib` files inside `runtime/node_modules` for `better-sqlite3`/`sharp`) still need an explicit `codesign` pass added before notarization will actually pass - see the `TODO` comment in `forge.config.ts`.

### Development

```bash
cd desktop
npm run prepare-runtime   # first time only, or after a server/shared code change
npm run dev
```

`npm run dev` only rebuilds the tray app itself, not the runtime folder - it doesn't call `prepare-runtime`, so a fresh clone (or a change to server/shared code) needs an explicit `prepare-runtime` run first. Re-run it whenever server or shared code changes; the tray app's own code (`desktop/src`, `desktop/ui`) is picked up by `npm run dev` alone.

## Repository layout

```
server/   Fastify + TypeScript backend: auth, scanning, thumbnails, SQLite, REST API
client/   React + TypeScript + Vite frontend
shared/   Shared DTOs, enums, and zod validation schemas used by both
desktop/  Electron tray app that packages the server as a Windows/macOS installer
```

## License

[MIT](LICENSE)
