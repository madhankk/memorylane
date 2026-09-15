# MemoryLane — Local & Test Deployment Playbook

**For:** anyone standing up MemoryLane on their own Mac or Windows machine to develop against or test — including the optional AI sidecar.
**Covers:** the `feature/media-intelligence-phase4-persons` branch (Phases 1–4: EXIF reports, stacks, AI similarity/search, People). Everything here also applies to `main` once the phase PRs (#1 → #2 → #3) merge.
**Last verified:** 2026-09-15 on macOS 26 / Apple Silicon (Node 20.19, Python 3.13). Windows steps use the same code paths and prebuilt binaries verified in the design doc §16; run through them once on a Windows box and tick the checklist at the end.

---

## 1. Which setup do I want?

| You are… | Recommended launch | Why |
|---|---|---|
| **Testing / reviewing** (most people) | **Production-style**: `npm run build` → `npm start`, plus the sidecar in a second terminal | Exactly what end users run; one server on `:4280` serving API + UI. |
| **Developing the server** | `npm run dev` (tsx watch) + sidecar | Restarts on every server file save. UI is the last built one. |
| **Developing the UI** | `npm run dev` + `npm run dev:client` (Vite on `:5173`) + sidecar | Hot reload; Vite proxies `/api` to `:4280`. Open `http://127.0.0.1:5173`. |
| **Testing the Windows/macOS installer** | Desktop tray app (`desktop/`), see §8 | Only when the packaged experience itself is under test. |

Two processes in every AI-enabled setup: the **MemoryLane server** (Node) and the **`memorylane-ai` sidecar** (Python). The sidecar is optional — without it the app works fully; Find similar, Describe-it search and stacks-v2 refinement just report "AI not available".

---

## 2. Prerequisites

### macOS (Apple Silicon)

```bash
xcode-select --install                 # git + compilers, one-time
brew install node@20 exiftool python@3.12
```
- Node **20 or 22** both work. (The tray app bundles its own Node; not needed here.)
- **ExifTool** must be on `PATH` (`exiftool -ver` → 12.x/13.x). Without it RAW previews and full EXIF are degraded.
- **Python 3.11–3.13** for the sidecar. The macOS system `python3` is often 3.9 — too old. Use Homebrew's (`brew --prefix python@3.12`/bin/python3.12) or python.org.
- Intel Macs: everything except vector search (LanceDB has no `darwin-x64` build in the pinned version). Out of scope for now.

### Windows 10/11 (x64 or ARM64)

Run in an elevated PowerShell (or use the installers' GUIs):

```powershell
winget install OpenJS.NodeJS.LTS          # Node 22 LTS (20+ is fine)
winget install Git.Git
winget install Python.Python.3.12         # tick "Add python.exe to PATH" if using the GUI installer
winget install OliverBetz.ExifTool        # puts exiftool.exe on PATH
```
- If ExifTool is installed by hand: download `exiftool-XX.zip`, rename `exiftool(-k).exe` → `exiftool.exe`, put it in a folder on `PATH`. Verify with `exiftool -ver` in a **new** terminal.
- Verify: `node -v`, `npm -v`, `py -3.12 --version`, `exiftool -ver`.
- No C++ build tools are needed: `better-sqlite3`, `sharp`, `@lancedb/lancedb`, `onnxruntime` and `tokenizers` all ship prebuilt Windows binaries.
- Keep the repo on a local disk (not OneDrive/network) — SQLite WAL and LanceDB want a normal filesystem.

### Both

- ~1 GB free for dependencies + the CLIP model (~350 MB, downloaded once into the Hugging Face cache: `~/.cache/huggingface` / `%USERPROFILE%\.cache\huggingface`).
- A test photo folder. Anything works; for burst/stack testing use a real camera burst (same body, frames < 2 s apart).

---

## 3. Get the code

```bash
git clone https://github.com/madhankk/memorylane.git
cd memorylane
git checkout feature/media-intelligence-phase3-embeddings   # until the phase PRs merge into main
npm install
```

`npm install` covers all four workspaces (`shared`, `server`, `client`, `desktop`). On Windows use the same commands in PowerShell.

---

## 4. Start the AI sidecar (optional, recommended for testing Phase 3)

Open a **second terminal** and leave it running.

macOS / Linux:
```bash
cd memorylane/memorylane-ai
python3.12 -m venv .venv                 # or python3 if it's ≥ 3.11
.venv/bin/pip install -e ".[dev]"
.venv/bin/memorylane-ai
```

Windows (PowerShell):
```powershell
cd memorylane\memorylane-ai
py -3.12 -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
.venv\Scripts\memorylane-ai
```

First start downloads the CLIP model (~350 MB); the face models (~38 MB) download on first use once People is enabled and then prints `Uvicorn running on http://127.0.0.1:4281`. Check it:

```bash
curl http://127.0.0.1:4281/v1/health
# {"ok":true,"device":"cpu","models":{"image_embed":{"id":"clip-vit-base-patch32@1","dim":512},...}}
```

Notes
- CPU is the default and does ~50 images/s on an M2 Max — a 50k-photo library embeds in under 20 minutes. GPU is optional: NVIDIA → `pip install onnxruntime-gpu` + `MEMORYLANE_AI_DEVICE=cuda`; Windows without CUDA → `pip install onnxruntime-directml` + `MEMORYLANE_AI_DEVICE=dml`.
- Docker alternative: `docker build -t memorylane-ai . && docker run -p 4281:4281 -v memorylane-hf:/root/.cache/huggingface memorylane-ai`.
- Keep it on `127.0.0.1` unless the server runs on another machine; then bind `MEMORYLANE_AI_HOST=0.0.0.0`, set `MEMORYLANE_AI_TOKEN` on both sides, and point the server at it with `MEMORYLANE_AI_URL`.
- Sidecar tests: `.venv/bin/pytest -q` (macOS) / `.venv\Scripts\pytest -q` (Windows) → 4 passed.

---

## 5. Start MemoryLane

### Production-style (recommended for testing)

```bash
cd memorylane
npm run build          # shared → client → server; ~30 s
npm start              # http://127.0.0.1:4280 opens in your browser
```

Windows: identical commands. To avoid the browser auto-opening: `$env:MEMORYLANE_NO_OPEN="1"; npm start` (PowerShell) or `MEMORYLANE_NO_OPEN=1 npm start` (bash).

### Development

```bash
npm run dev            # server with tsx watch on :4280
npm run dev:client     # optional, Vite UI on :5173 with hot reload
```

### First run

1. The first page is **Setup** — create the single admin account. Setup is only allowed from the machine itself (loopback) unless `MEMORYLANE_ALLOW_REMOTE_SETUP=1`.
2. **Settings › Scan Folders** → add your photo folder → **Run Scan Now**. Thumbnails and full EXIF are written during the scan.
3. Watch **Settings › Analysis**: `exif_full`, `phash`, and (if the sidecar is up) `embed_image` counts move from Pending to Done. Stacks recompute once the queue drains.
4. **Settings › AI** shows `Connected to http://127.0.0.1:4281 · clip-vit-base-patch32@1 · cpu`. If it says *Not connected*, start the sidecar (§4) — queued photos are analysed automatically when it appears.

### Where the data lives (safe to delete; a rescan rebuilds everything)

| OS | Data directory |
|---|---|
| macOS | `~/Library/Application Support/MemoryLane` |
| Windows | `%LOCALAPPDATA%\MemoryLane` |
| Linux | `~/.local/share/MemoryLane` |

Contents: `memorylane.sqlite` (index, EXIF, stacks, embeddings), `thumbnails/`, `previews/`, `vectors/` (LanceDB cache — rebuilt from the DB on startup if missing), `logs/`. Override with `MEMORYLANE_DATA_DIR` — handy for a throwaway test library:

```bash
MEMORYLANE_DATA_DIR=/tmp/ml-test MEMORYLANE_PORT=4299 npm start
```
```powershell
$env:MEMORYLANE_DATA_DIR="$env:TEMP\ml-test"; $env:MEMORYLANE_PORT="4299"; npm start
```

---

## 6. Configuration reference

| Variable | Default | Notes |
|---|---|---|
| `MEMORYLANE_DATA_DIR` | OS app-data dir | DB, thumbnails, vectors, logs |
| `MEMORYLANE_PORT` | `4280` | |
| `MEMORYLANE_BIND_ADDRESS` | `0.0.0.0` | Reachable on the LAN by default; `127.0.0.1` to restrict |
| `MEMORYLANE_ALLOW_REMOTE_SETUP` | unset | `1` to allow first-run setup from another device |
| `MEMORYLANE_NO_OPEN` | unset | `1` = don't auto-open a browser |
| `MEMORYLANE_AI_PROVIDER` | `sidecar` | `none` disables all AI analyzers and endpoints |
| `MEMORYLANE_AI_URL` | `http://127.0.0.1:4281` | Where the sidecar is |
| `MEMORYLANE_AI_TOKEN` | unset | Must match the sidecar's token if set |
| `MEMORYLANE_AI_MODEL` | `clip-vit-base-patch32@1` | Must equal the id the sidecar reports, or the server refuses to mix vectors |
| `LOG_LEVEL` | `info` | pino level |

In-app settings (Settings page): scan schedule, stack thresholds (`gap seconds`, `max hash distance`, `min cosine`), AI on/off.

---

## 7. Smoke-test checklist

Run through this after every fresh setup (≈10 minutes). All steps have passed on macOS; tick the Windows column on first run there.

| # | Check | macOS | Windows |
|---|---|---|---|
| 1 | `npm test` → all green; `npm run typecheck` clean | ✅ | ☐ |
| 2 | Sidecar `pytest -q` → 4 passed; `/v1/health` returns `ok: true` | ✅ | ☐ |
| 3 | Setup account → add folder → scan completes; thumbnails render in Browse | ✅ | ☐ |
| 4 | Settings › Analysis: `exif_full` / `phash` / `embed_image` reach Done = scanned count | ✅ | ☐ |
| 5 | **Reports**: facets populate; clicking a lens/camera narrows the grid and the URL; Export CSV downloads | ✅ | ☐ |
| 6 | **Stacks**: a burst collapses to one tile with a count badge; panel → set cover / remove / delete work; Select mode → manual stack | ✅ | ☐ |
| 7 | **Find similar** (Viewer ✨) shows neighbours with scores; burst siblings first | ✅ | ☐ |
| 8 | **Search › Describe it (AI)** returns sensible photos for a plain-language query | ✅ | ☐ |
| 9 | Stop the sidecar → Settings › AI shows *Not connected*; Describe-it shows the AI-unavailable notice; nothing errors. Start it → Analysis resumes by itself | ✅ | ☐ |
| 10 | Delete `<data>/vectors/`, restart server → log line `Rebuilt vector index`, Find similar still works | ✅ | ☐ |
| 11 | RAW (CR3/NEF/ARW…) thumbnails and previews render; RAW+JPEG pairs show as one tile | ✅ (existing) | ☐ |
| 12 | Windows only: paths with spaces/Unicode and a scan root on a second drive (`D:\Photos`) index correctly | – | ☐ |
| 13 | **People** (Settings › People on, min faces 2 for a small library): faces detected, persons appear after the queue drains, rename / ✗ not-them / merge work, "Delete all face data" empties the page | ✅ | ☐ |

Tests: `npm test` (server, in-memory SQLite, needs no sidecar), `npm run typecheck`, `memorylane-ai/.venv/bin/pytest -q`.

---

## 8. Desktop tray app (installer test, optional)

Only after a successful root build:

```bash
npm run build
cd desktop && npm install
npm run prepare-runtime     # copies node + server/dist + prod deps into desktop/runtime/
npm run package             # quick: packaged app folder only
npm run make                # full: .dmg (macOS) / Squirrel .exe (Windows) in desktop/release/<version>/
```

- The runtime folder now includes `@lancedb/lancedb`; the Phase 3 verification of vector search **from inside `desktop/runtime/`** is still an open checklist item (see §10).
- The sidecar is **not** bundled in the installer. Users who want AI features run it separately (§4) — the tray app simply shows *Not connected* until then.
- Unsigned builds: macOS blocks launch (right-click → Open, or sign), Windows shows SmartScreen. Signing requires the code-signing setup described in the README.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Cannot find module 'ffmpeg-static'` on typecheck/start | `node_modules` older than the lockfile → `npm install` again. |
| RAW files show `!` badge, Reports empty | ExifTool not on PATH (`exiftool -ver` in a fresh terminal). Install, restart the server, run **Retry failed** under Settings › Analysis or rescan. |
| Settings › AI: *Not connected — fetch failed* | Sidecar not running or on another port; check `curl http://127.0.0.1:4281/v1/health`. |
| Settings › AI: *Sidecar model X does not match configured Y* | `MEMORYLANE_AI_MODEL` (server) ≠ model the sidecar loaded (`MEMORYLANE_AI_MODEL` repo on the sidecar). Align them; vectors are never mixed across models. |
| `embed_image` stuck at Pending, row says *waiting for sidecar* | Backoff after an outage (5 s → 5 min). It resumes automatically; restarting the server resets the backoff immediately. |
| Sidecar fails on first start with an SSL / download error | No access to huggingface.co. Download once on a connected machine and copy `~/.cache/huggingface/hub/models--Xenova--clip-vit-base-patch32` over, or set `HF_HUB_OFFLINE=1` after copying. |
| Windows: `py` not found | Use `python` instead, or reinstall Python with "Add to PATH". |
| Windows: sidecar `pip install` builds something | It shouldn't — all deps are prebuilt for 3.11–3.13 x64. Check `py -3.12 --version` isn't 3.14+ or 32-bit. |
| Port 4280/4281 in use | `MEMORYLANE_PORT`, `MEMORYLANE_AI_PORT` (+ `MEMORYLANE_AI_URL` on the server). |
| Want to start over | Stop both processes, delete the data directory (§5), start again, rescan. Photos are never touched. |

Logs: server → terminal (and `<data>/logs/`); sidecar → its terminal.

---

## 10. Open items before calling the release "done"

- Merge order: PR #1 (EXIF/Reports) → #2 (Stacks) → #3 (AI). Each retargets to `main` automatically as the previous one merges.
- Run the §7 checklist on a Windows machine and record results.
- Verify LanceDB loads from `desktop/runtime/` (packaged tray app) on both OSes.
- Decide whether/how to ship the sidecar with the installer (PyInstaller `onedir` next to the tray app) — not planned for Phases 1–4.
- The optional Phase 5 (LLM captions/keywords) is not started — see the design doc §11.
