# MemoryLane

Self-hosted photo and video browser. Reconnect with the memories already sitting in your photo archive.

MemoryLane indexes existing photo folders in place, generates thumbnails, and helps you rediscover old photos through browsing and "Surprise Me" style random rediscovery. It never renames, moves, or modifies your original files. See [PLAN.md](PLAN.md) for the full engineering plan.

Photos are the v1 focus; video indexing/playback is deferred.

## Requirements

- Node.js 20+
- [ExifTool](https://exiftool.org/) available on PATH (RAW metadata/preview extraction; standard image browsing still works without it)
- ffmpeg/ffprobe (optional in v1 - reserved for the later video phase)

## Development

```bash
npm install
npm run dev          # starts the Fastify server on :4280
npm run dev:client   # in a second terminal - Vite dev server on :5173 with API proxy
```

Open `http://localhost:5173` during development (the client dev server proxies `/api` to the backend).

## Production

```bash
npm run build
npm start
```

`npm start` runs a single Node process serving both the API and the built client from `http://127.0.0.1:4280`.

## Data

MemoryLane's database, thumbnail cache, and logs live in an OS-standard app-data directory (e.g. `%LOCALAPPDATA%\MemoryLane` on Windows) - entirely separate from your photo folders, and safe to delete and rebuild via a rescan at any time. Override the location with the `MEMORYLANE_DATA_DIR` environment variable.

## Repository layout

```
server/   Fastify + TypeScript backend: auth, scanning, thumbnails, SQLite, REST API
client/   React + TypeScript + Vite frontend
shared/   Shared DTOs, enums, and zod validation schemas used by both
```
