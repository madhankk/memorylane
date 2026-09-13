# MemoryLane

Self-hosted photo and video browser for rediscovering the memories already sitting in your photo archive.

MemoryLane indexes existing photo folders in place, generates thumbnails, and helps you rediscover old photos through browsing, search, and "Surprise Me" style random rediscovery - all on your own hardware, over your own files. It never renames, moves, or modifies your originals. See [PLAN.md](PLAN.md) for the full engineering plan.

Photos are the v1 focus; video indexing/playback is deferred.

## Features

- **Local-first, self-hosted** - your photos never leave your machine. No cloud upload, no third-party indexing, no subscription.
- **Read-only, filesystem-as-source-of-truth** - MemoryLane only reads your originals. It builds a disposable SQLite index and thumbnail cache alongside them; delete that cache anytime and rescan to rebuild it from scratch.
- **Fast browsing at any library size** - folder tree navigation with infinite scroll, full-text search across folders and files, and per-scan-folder stats (item counts, cache size on disk).
- **Broad RAW support** - every major camera maker's RAW format is indexed with embedded-preview thumbnails and a larger fullscreen preview tier, both correctly oriented from the RAW file's own EXIF: Canon (CR2/CR3/CRAW/CRW), Nikon (NEF/NRW), Sony (ARW/SRF/SR2/ARQ), Fujifilm (RAF), Olympus/OM System (ORF), Panasonic/Lumix (RW2), Pentax (PEF), Samsung (SRW), Sigma (X3F), Minolta (MRW), Kodak (DCR/K25/KDC), Hasselblad (3FR/FFF), Mamiya/Leaf (MEF/MOS), Phase One (IIQ), and Adobe DNG.
- **Rediscovery, not just browsing** - a home hero card surfaces a random photo with a subtle "June 2007 · Chennai · 19 years ago" caption, tabbed **Random Memory** / **This Day, Another Time** mini slideshows, and a full "Surprise Me" fullscreen mode.
- **Lightweight, invisible engagement tracking** - a simple favorite star and quiet shown/viewed counters bias rediscovery toward photos you haven't seen in a while, without ever turning into an analytics dashboard.
- **Four themes** - light, dark, dusk, and gallery, switchable at any time.
- **Multi-folder libraries** - scan multiple folders/drives, reorder them, and trigger a rescan of just one folder at a time from Settings.
- **Ignore folders you don't want indexed** - a global ignore list (Settings, or click "Ignore folder" while browsing one) tells the scanner to permanently skip a path - it removes that folder and its already-indexed items from your library without touching the original files.

## Requirements

- Node.js 20+
- [ExifTool](https://exiftool.org/) available on PATH (RAW metadata/preview extraction; standard image browsing still works without it)
- ffmpeg/ffprobe (optional in v1 - reserved for the later video phase)

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

MemoryLane has no HTTPS/TLS support, so traffic (including your session cookie and the photos themselves) is unencrypted on the network - fine on a trusted home LAN, but don't expose the default `0.0.0.0` bind directly to the internet (e.g. via router port-forwarding) without putting a reverse proxy with real TLS in front of it.

## Data

MemoryLane's database, thumbnail cache, and logs live in an OS-standard app-data directory (e.g. `%LOCALAPPDATA%\MemoryLane` on Windows) - entirely separate from your photo folders, and safe to delete and rebuild via a rescan at any time. Override the location with the `MEMORYLANE_DATA_DIR` environment variable.

## Upgrading

```bash
git pull
npm install
npm run build
npm start
```

The database schema is versioned via numbered SQL files in `server/migrations/`, tracked in a `schema_migrations` table. Every server start applies any migrations it hasn't seen yet, in order, each in its own transaction - there's no manual DB migration step to run. Before applying any pending migration, the server automatically snapshots the SQLite database to `<data-dir>/memorylane.sqlite.pre-migration-<timestamp>.bak` (keeping the last 5), so a bad upgrade can be rolled back by stopping the server, restoring the most recent `.bak` over `memorylane.sqlite`, and restarting the previous version.

Occasionally a migration needs to invalidate existing thumbnails (e.g. to fix a rendering bug) - when that happens, affected thumbnails simply regenerate the next time a scan runs, with no action needed beyond triggering a scan (automatic on schedule, or manually from Settings).

## Repository layout

```
server/   Fastify + TypeScript backend: auth, scanning, thumbnails, SQLite, REST API
client/   React + TypeScript + Vite frontend
shared/   Shared DTOs, enums, and zod validation schemas used by both
```

## License

[MIT](LICENSE)
