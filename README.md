# MemoryLane

Self-hosted photo and video browser for rediscovering the memories already sitting in your photo archive.

MemoryLane indexes existing photo folders in place, generates thumbnails, and helps you rediscover old photos through browsing, search, and "Surprise Me" style random rediscovery - all on your own hardware, over your own files. It never renames, moves, or modifies your originals. See [PLAN.md](PLAN.md) for the full engineering plan.

Photos are the v1 focus; video indexing/playback is deferred.

## Features

- **Local-first, self-hosted** - your photos never leave your machine. No cloud upload, no third-party indexing, no subscription.
- **Read-only, filesystem-as-source-of-truth** - MemoryLane only reads your originals. It builds a disposable SQLite index and thumbnail cache alongside them; delete that cache anytime and rescan to rebuild it from scratch.
- **Fast browsing at any library size** - folder tree navigation with infinite scroll, full-text search across folders and files, and per-scan-folder stats (item counts, cache size on disk).
- **RAW support** - CR2, CR3, CRAW, NEF, ARW, RAF, and DNG are indexed with embedded-preview thumbnails and a larger fullscreen preview tier, both correctly oriented from the RAW file's own EXIF.
- **Rediscovery, not just browsing** - a home hero card surfaces a random photo with a subtle "June 2007 · Chennai · 19 years ago" caption, tabbed **Random Memory** / **This Day, Another Time** mini slideshows, and a full "Surprise Me" fullscreen mode.
- **Lightweight, invisible engagement tracking** - a simple favorite star and quiet shown/viewed counters bias rediscovery toward photos you haven't seen in a while, without ever turning into an analytics dashboard.
- **Four themes** - light, dark, dusk, and gallery, switchable at any time.
- **Multi-folder libraries** - scan multiple folders/drives, reorder them, and trigger a rescan of just one folder at a time from Settings.

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
| `MEMORYLANE_BIND_ADDRESS` | `127.0.0.1` | Bind address - set to `0.0.0.0` to expose beyond localhost (e.g. on a home server/NAS) |

## Data

MemoryLane's database, thumbnail cache, and logs live in an OS-standard app-data directory (e.g. `%LOCALAPPDATA%\MemoryLane` on Windows) - entirely separate from your photo folders, and safe to delete and rebuild via a rescan at any time. Override the location with the `MEMORYLANE_DATA_DIR` environment variable.

## Repository layout

```
server/   Fastify + TypeScript backend: auth, scanning, thumbnails, SQLite, REST API
client/   React + TypeScript + Vite frontend
shared/   Shared DTOs, enums, and zod validation schemas used by both
```

## License

[MIT](LICENSE)
