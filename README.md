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

### Without the desktop tray (day-to-day work)

Use two terminals:

```bash
npm install
npm run dev          # starts the Fastify server on :4280
npm run dev:client   # in a second terminal - Vite dev server on :5173 with API proxy
```

Open `http://localhost:5173` (the client dev server proxies `/api` to the backend). This is the fastest inner loop - no Go build, no runtime staging - and is what you want for almost all server/client work.

### Building and running a plugin

Plugins live under `plugins/` (`required/`, `optional/`, or a new folder of your own) as a `manifest.template.json` plus source; `plugins/fixtures/com.memorylane.fixture-module` is a minimal example. Against a server already running from `npm run dev`, exercise your plugin with a local catalog instead of a real signing key or a hosted feed:

```bash
npm run build --workspace=plugin-sdk
npm run plugins:build -- stable development
```

`development` (skip it if you have the real key - see below) generates a throwaway signing keypair and writes its public half to `dist/plugin-repository/v1/stable/development-public-key.pem`. Point the server at both, using absolute paths since `npm run dev` runs with its cwd inside `server/`:

```bash
MEMORYLANE_BUNDLED_PLUGIN_REPOSITORY=/absolute/path/to/dist/plugin-repository/v1/stable \
MEMORYLANE_PLUGIN_PUBLIC_KEY=/absolute/path/to/dist/plugin-repository/v1/stable/development-public-key.pem \
npm run dev
```

Restart the server with the same two variables set. Then in Settings → Plugins, install and enable your plugin by id/version - the server serves install/update requests from that local directory instead of a real HTTPS catalog whenever `MEMORYLANE_PLUGIN_CATALOG_URL` isn't set. After changing plugin source, re-run `npm run plugins:build -- stable development` and hit **Install** again (bump `version` in `manifest.template.json` first if you want **Update** instead, which requires a strictly newer version).

If `.keys/plugin-release-private.pem` exists locally (see "Building for production" below), drop `development` and `MEMORYLANE_PLUGIN_PUBLIC_KEY` entirely - the build signs with the real key, which the server trusts by default.

### With the desktop tray

Only needed when working on `tray-go/` itself (the system tray, process supervision, launch-at-login, the updater) or verifying the packaged experience. Build the web/server output and stage its isolated runtime first:

```bash
npm run build
npm run desktop:runtime
go -C tray-go run .
```

Run `go -C tray-go run .` from the repo root (as shown) or from inside `tray-go/` - both are auto-detected with no extra configuration. After server, shared, or client changes, repeat `npm run build && npm run desktop:runtime`. Changes confined to `tray-go/` only need `go -C tray-go run .` restarted.

By default `npm run desktop:runtime` doesn't include required plugins (metadata-raw, video-tools) unless `.keys/plugin-release-private.pem` exists locally (see "Building for production" below) - without it, the tray installs them from the network catalog on first launch instead, same as an end user's machine would.

For an isolated supervisor check without the full tray UI, run `go -C tray-go run . --smoke-test` after preparing the runtime.

## Configuration

MemoryLane is configured entirely through environment variables (no config file):

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEMORYLANE_DATA_DIR` | OS-standard app-data dir | Where the SQLite database, thumbnail cache, and logs are stored |
| `MEMORYLANE_PORT` | `4280` | Port the server listens on |
| `MEMORYLANE_BIND_ADDRESS` | `0.0.0.0` | Bind address - `0.0.0.0` (the default) listens on every network interface, so other devices on your LAN (phone, tablet, another computer) can reach it at `http://<this-machine's-LAN-IP>:4280`. Set to `127.0.0.1` to restrict it to this machine only. |
| `MEMORYLANE_ALLOW_REMOTE_SETUP` | unset (disabled) | Initial admin account setup is restricted to the machine hosting MemoryLane by default - since the server is reachable on your LAN as soon as it starts, this stops someone else on the network from claiming the one admin account before you do. Set to `1` to allow completing setup from another device. |
| `MEMORYLANE_PLUGIN_DIR` | OS-standard local application support | Fixed location for installed plugin code and activation state. This does not move with the media data directory. |
| `MEMORYLANE_PLUGIN_CATALOG_URL` | unset when running from source (`npm run dev`/`npm start`) | HTTPS URL of the signed first-party `catalog.json`. Plugin installation remains unavailable until configured. Packaged desktop builds compile in `https://memorylaneapp.org/plugins/v1/stable/catalog.json` as the default (see `tray-go/scripts/package-*`) - set this to override it, e.g. for a beta channel or a self-hosted mirror. |
| `MEMORYLANE_PLUGIN_PUBLIC_KEY` | unset | Ed25519 public key PEM or path to a PEM file used to verify the catalog and plugin artifacts. |
| `MEMORYLANE_PLUGIN_ALLOW_HTTP` | unset (disabled) | Development only: permits an HTTP catalog. Artifact HTTP remains restricted to loopback. |

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

`tray-go/` packages MemoryLane as a small native tray app for non-developers. It manages the server process, launch-at-login, browser opening, and signed updates without an embedded browser engine. It bundles Node so target machines need no separate Node.js installation. See "Development" above for running it locally - this section is the production build sequence.

### Building for production

Every command below runs from the repo root, in order. Three keys already exist at their default repo locations and are picked up automatically with **no configuration needed** - override only if you want something different:

| Key | Default location | Override |
| --- | --- | --- |
| Plugin signing key | `.keys/plugin-release-private.pem` | `MEMORYLANE_PLUGIN_SIGNING_KEY` |
| Plugin catalog URL (compiled into the tray) | `https://memorylaneapp.org/plugins/v1/stable/catalog.json` | `MEMORYLANE_PLUGIN_CATALOG_URL` |
| Update manifest public key (compiled into the tray) | the real key from `desktop:update-keygen` | `MEMORYLANE_UPDATE_PUBLIC_KEY` |

**1. Build the core**

```bash
npm install
npm run build
```

**2. Package the installer**

```bash
npm run desktop:package     # Windows: staged app + ZIP
npm run desktop:installer   # Windows: also builds MemoryLane-Setup.exe (needs Inno Setup 7+)
bash tray-go/scripts/package-macos.sh   # macOS: run on macOS - builds .app + DMG
```

This assembles `tray-go/runtime`, compiles the tray, and bundles the two **required** plugins (metadata-raw, video-tools) directly into the package using the signing key above, so a fresh install works with zero network access on first launch. If that key isn't present on the build machine, this step is skipped and the package falls back to the small downloader build instead - it installs required plugins from the network catalog on first launch, same as step 4 provides for optional ones.

`MEMORYLANE_UPDATE_FEED_URL` has **no default** - leave it unset until step 5 has actually published a feed, otherwise the tray just reports "Updates not configured" and does nothing.

Output lands in `tray-go/release/<version>/`: the staged app + ZIP, `MemoryLane-Setup.exe` if you ran `desktop:installer` (a native 64-bit installer - `installer.iss` uses Inno Setup 7's `SetupArchitecture=x64`), or a `.app` + DMG on macOS.

**3. Code-sign (optional)**

```powershell
$env:SIGN_RELEASE = "1"
npm run desktop:installer
```

Signs `MemoryLane.exe`, `node-runtime.exe`, and `MemoryLane-Setup.exe` through the Azure Trusted Signing scripts under `tray-go/scripts`. On macOS, `SIGN_RELEASE=1` also signs the tray, Node runtime, native modules, and app bundle, then notarizes and staples the DMG (needs `MACOS_SIGNING_IDENTITY` and `APPLE_NOTARY_KEYCHAIN_PROFILE`).

**4. Publish the full plugin catalog (optional plugins included)**

Step 2 only bundles the two *required* plugins. Optional ones (AI Runtime, AI Search, People, Apple Photos) are installed on demand from the hosted catalog instead - publishing that catalog is separate:

```bash
npm run plugins:prepare-required
npm run plugins:prepare-ai-runtime
npm run plugins:prepare-apple-photos   # macOS only
npm run plugins:build -- stable        # signs with .keys/plugin-release-private.pem automatically
npm run plugins:verify -- dist/plugin-repository/v1/stable
```

Then upload `dist/plugin-repository/v1/stable/` to `https://memorylaneapp.org/plugins/v1/stable/` (the URL step 2 already points at by default) - see [plugin repository deployment](docs/plugin-repository-deployment.md) for the atomic-upload procedure and hosting details.

**5. Publish a core update (optional, once you're ready to ship an update to existing installs)**

```bash
MEMORYLANE_UPDATE_PRIVATE_KEY=.keys/core-update-private.pem \
  npm run desktop:update-manifest -- <installer-path> <public-installer-url> <output-manifest.json>
```

Upload the signed installer and the manifest it produced to `https://memorylaneapp.org/updates/<platform>/` (`win32-x64`, `darwin-x64`, `darwin-arm64`), then set `MEMORYLANE_UPDATE_FEED_URL` to that manifest's URL for future packaging runs (step 2) - from then on, every new package points existing installs at the update.

## Repository layout

```
server/   Fastify + TypeScript backend: auth, scanning, thumbnails, SQLite, REST API
client/   React + TypeScript + Vite frontend
shared/   Shared DTOs, enums, and zod validation schemas used by both
tray-go/  Native Windows/macOS tray, process supervisor, updater, and packaging
```

## License

[MIT](LICENSE)
