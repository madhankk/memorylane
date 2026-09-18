# MemoryLane — Local & Test Deployment Playbook

**For:** anyone standing up MemoryLane on their own Mac or Windows machine to develop against or test — including the optional AI sidecar.
**Covers:** the current media-intelligence features and the optional Apple Photos plugin on `feature/apple-photos`.
**Last verified:** 2026-09-15 on macOS 26 / Apple Silicon (Node 20.19, Python 3.13). Windows steps use the same code paths and prebuilt binaries verified in the design doc §16; run through them once on a Windows box and tick the checklist at the end.

---

## 1. Which setup do I want?

| You are… | Recommended launch | Why |
|---|---|---|
| **Testing / reviewing** (most people) | **Production-style**: `npm run build` → `npm start`, plus `npm run ai` in a second terminal | Exactly what end users run; one server on `:4280` serving API + UI. |
| **Developing the server** | `npm run dev` (tsx watch) + `npm run ai` | Restarts on every server file save. UI is the last built one. |
| **Developing the UI** | `npm run dev` + `npm run dev:client` (Vite on `:5173`) + `npm run ai` | Hot reload; Vite proxies `/api` to `:4280`. Open `http://127.0.0.1:5173`. |
| **Testing the Windows/macOS installer** | Native tray app (`tray-go/`), see §8 | Only when the packaged experience itself is under test. |

Two processes in every AI-enabled setup: the **MemoryLane server** (Node) and the **`memorylane-ai` sidecar** (Python). The sidecar is optional — without it the app works fully; Find similar, Describe-it search, stacks-v2 refinement and People just report "AI not available".

Apple Photos is a separate, optional third process on macOS. It is not part of the AI sidecar and is never started merely because MemoryLane starts.

### Apple Photos plugin (macOS only)

In **Settings → Plugins**, enable Apple Photos. In a separate terminal run `npm run photos-helper`; the first launch creates an isolated Python environment and installs `osxphotos` into the MemoryLane data directory. Leave that command running while you sync. Use **Add library** to select a local `.photoslibrary` package, then **Sync now**. The helper listens only on `127.0.0.1:4282` and shares a private token with the server through the data directory. Use the same `MEMORYLANE_DATA_DIR` for both commands if you override the default. The AI sidecar remains independent and is needed only for embeddings and faces.

Both the server and the helper need read permission for the Photos package. If sync reports an access error, grant the launching terminal/app Full Disk Access in **System Settings → Privacy & Security**, then restart it. Neither process modifies the Photos library. Local originals are used when available; otherwise an available preview is imported and labeled preview-only. An asset with neither local file is skipped until a later sync. Imported local files receive the normal thumbnail, EXIF, visual fingerprint, embedding and face analysis (the latter two need the AI sidecar; faces also need People enabled). Photos catalogue dates and other available metadata are retained alongside extracted file metadata.

Disabling the plugin hides its imported media and stops new sync/analysis work without deleting the MemoryLane index or Photos files. Press Ctrl+C in the helper terminal to release its process memory. Restart the MemoryLane server if you also want to unload previously imported plugin JavaScript modules. Re-enable and sync to refresh the index. Apple albums and downloading iCloud originals are not supported in this release; **Open in Photos** is offered for a preview-only item instead.

Manual macOS smoke check: enable the plugin; start the helper; add a small readable library; sync and compare indexed/preview/skipped counts with the catalogue; open a local original and a preview-only item; verify EXIF and face analysis progress; use **Open in Photos** (grant Automation permission if prompted); then disable and verify direct media and face-crop URLs return 404. Re-enable, resync, and verify media IDs are stable. A real-library run remains necessary before declaring the feature production-ready.

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

### macOS: photo libraries on a NAS or external drive

macOS grants access to **network** and **removable** volumes per app. Launch `npm start` (and the sidecar) from a terminal app that has that permission — Terminal.app usually prompts the first time; VS Code's integrated terminal often doesn't and silently gets *Operation not permitted*. Check under System Settings → Privacy & Security → Files and Folders.

### Both

- ~1.5 GB free for dependencies + models (CLIP ~350 MB in `~/.cache/huggingface`, face models ~38 MB in `~/.cache/memorylane-ai`; Windows: `%USERPROFILE%\.cache\...`). Downloaded once.
- A test photo folder. Anything works; for burst/stack testing use a real camera burst (same body, frames < 2 s apart).

---

## 3. Get the code

```bash
git clone https://github.com/madhankk/memorylane.git
cd memorylane
git checkout feature/media-intelligence-phase4-persons   # until the phase PRs merge into main
npm install
```

`npm install` covers all four workspaces (`shared`, `server`, `client`, `desktop`). On Windows use the same commands in PowerShell.

---

## 4. Start the AI sidecar (optional — needed for Find similar, Describe-it search, stacks v2 and People)

Open a **second terminal**, leave it running:

```bash
npm run ai
```

That one command works on macOS, Windows and Linux: it finds a Python 3.11+ (`python3`, or `py -3` on Windows), creates `memorylane-ai/.venv` if missing, installs the package on first run (or when its dependencies change), and starts the service. First start also downloads the CLIP model (~350 MB); the face models (~38 MB) download the first time People runs. You'll see `Uvicorn running on http://127.0.0.1:4281`. Check it:

```bash
curl http://127.0.0.1:4281/v1/health
# {"ok":true,"device":"cpu","models":{"image_embed":{"id":"clip-vit-base-patch32@1","dim":512},"faces":{"id":"yunet-sface@1","dim":128},...}}
```

Environment variables pass straight through (`MEMORYLANE_AI_PORT=4282 npm run ai`, `MEMORYLANE_AI_DEVICE=cuda npm run ai`, …). Manual setup, Docker, and the full variable table are in [memorylane-ai/README.md](../memorylane-ai/README.md).

Notes
- CPU is the default and does ~50 images/s (embeddings) and ~10 images/s (faces) on an M2 Max. GPU is optional: NVIDIA → `pip install onnxruntime-gpu` in the venv + `MEMORYLANE_AI_DEVICE=cuda`; Windows without CUDA → `pip install onnxruntime-directml` + `MEMORYLANE_AI_DEVICE=dml`.
- Keep it on `127.0.0.1` unless the server runs on another machine; then set `MEMORYLANE_AI_HOST=0.0.0.0` and `MEMORYLANE_AI_TOKEN` on both sides, and point the server at it with `MEMORYLANE_AI_URL`.
- **Launch it from the same kind of terminal as the server** (see the macOS note in §2) — the sidecar itself never touches your photo folders, but the venv lives inside the repo.
- Sidecar tests: `memorylane-ai/.venv/bin/pytest -q` (macOS/Linux) / `memorylane-ai\.venv\Scripts\pytest -q` (Windows) → 9 passed.

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
3. Watch **Settings › Analysis**: progress bars for *EXIF metadata*, *Visual fingerprints* and (with the sidecar up) *AI embeddings* run to 100 %, with an ETA while working. Stacks recompute once the queue drains.
4. **Settings › AI** shows `Connected to http://127.0.0.1:4281 · clip-vit-base-patch32@1 · cpu`. If it says *Not connected*, start the sidecar (§4) — queued photos are analysed automatically when it appears.
5. Optional — **Settings › People** → *Find and group faces*. The *Faces* bar starts moving; people appear on the **People** page after the queue drains (lower *Faces needed to create a person* to 2 for a small test library).

### Where the data lives (safe to delete; a rescan rebuilds everything)

| OS | Data directory |
|---|---|
| macOS | `~/Library/Application Support/MemoryLane` |
| Windows | `%LOCALAPPDATA%\MemoryLane` |
| Linux | `~/.local/share/MemoryLane` |

Contents: `memorylane.sqlite` (index, EXIF, stacks, embeddings, faces), `thumbnails/`, `previews/` (usually the largest — RAW fullscreen tier), `vectors/` (LanceDB cache — rebuilt from the DB on startup if missing), `faces/` (crop cache), `logs/`. **Settings › Storage** shows the location and per-folder sizes and has **Move data here** to relocate everything to another disk (copies, then asks for a restart; the old copy stays until you delete it). Override with `MEMORYLANE_DATA_DIR` — handy for a throwaway test library:

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
| `MEMORYLANE_DATA_DIR` | OS app-data dir (or the folder chosen under Settings › Storage) | DB, thumbnails, previews, vectors, face crops, logs. When set, it wins over the Settings choice. |
| `MEMORYLANE_PORT` | `4280` | |
| `MEMORYLANE_BIND_ADDRESS` | `0.0.0.0` | Reachable on the LAN by default; `127.0.0.1` to restrict |
| `MEMORYLANE_ALLOW_REMOTE_SETUP` | unset | `1` to allow first-run setup from another device |
| `MEMORYLANE_NO_OPEN` | unset | `1` = don't auto-open a browser |
| `MEMORYLANE_AI_PROVIDER` | `sidecar` | `none` disables all AI analyzers and endpoints |
| `MEMORYLANE_AI_URL` | `http://127.0.0.1:4281` | Where the sidecar is |
| `MEMORYLANE_AI_TOKEN` | unset | Must match the sidecar's token if set |
| `MEMORYLANE_AI_MODEL` | `clip-vit-base-patch32@1` | Must equal the id the sidecar reports, or the server refuses to mix vectors |
| `MEMORYLANE_AI_FACE_MODEL` | `yunet-sface@1` | Same rule for the face model |
| `LOG_LEVEL` | `info` | pino level |

In-app settings (Settings page): scan schedule; AI on/off; People on/off, match strictness, faces needed per person; stack thresholds (gap seconds, max hash distance, min cosine).

---

## 7. Smoke-test checklist

Run through this after every fresh setup (≈10 minutes). All steps have passed on macOS; tick the Windows column on first run there.

| # | Check | macOS | Windows |
|---|---|---|---|
| 1 | `npm test` → all green; `npm run typecheck` clean | ✅ | ☐ |
| 2 | `npm run ai` starts the sidecar; `/v1/health` returns `ok: true`; `pytest -q` → 9 passed | ✅ | ☐ |
| 3 | Setup account → add folder → scan completes; thumbnails render in Browse | ✅ | ☐ |
| 4 | Settings › Analysis: `exif_full` / `phash` / `embed_image` (and `faces` once People is on) reach Done = scanned count | ✅ | ☐ |
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
npm run desktop:package     # Windows staged folder + ZIP
npm run desktop:installer   # Windows Inno Setup installer
bash tray-go/scripts/package-macos.sh  # macOS .app + DMG
```

- Required and optional feature runtimes are installed through the plugin repository.
- Unsigned builds: macOS blocks launch (right-click → Open, or sign), Windows shows SmartScreen. Signing requires the code-signing setup described in the README.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Settings page stuck on *Loading…*, or some `/api/...` calls return 404 while others work | Two MemoryLane servers on port 4280 — an older checkout's `npm start` (bound to `127.0.0.1`) is still running alongside the new one (bound to `0.0.0.0`), and your browser reaches the old API with the new UI. `lsof -nP -iTCP:4280 -sTCP:LISTEN` (macOS/Linux) / `netstat -ano \| findstr :4280` (Windows) shows both; stop the old PID and reload. |
| `Cannot find module 'ffmpeg-static'` on typecheck/start | `node_modules` older than the lockfile → `npm install` again. |
| Analysis rows fail with *Error opening file* / Faces *unsupported* on a NAS or external drive, although the folder scanned fine before | macOS privacy (TCC): the app you launched `npm start` from (e.g. VS Code's integrated terminal) has no **Network Volumes** / **Removable Volumes** permission, so every open on that volume returns *Operation not permitted*. System Settings → Privacy & Security → Files and Folders → that app → enable Network/Removable Volumes (or Full Disk Access), restart the server, then **Retry failed** under Settings › Analysis. Or launch from Terminal.app. |
| RAW files show `!` badge, Reports empty | ExifTool not on PATH (`exiftool -ver` in a fresh terminal). Install, restart the server, run **Retry failed** under Settings › Analysis or rescan. |
| Settings › AI: *Not connected — fetch failed* | Sidecar not running or on another port; check `curl http://127.0.0.1:4281/v1/health`. |
| Settings › AI: *Sidecar model X does not match configured Y* | `MEMORYLANE_AI_MODEL` (server) ≠ model the sidecar loaded (`MEMORYLANE_AI_MODEL` repo on the sidecar). Align them; vectors are never mixed across models. |
| `embed_image` stuck at Pending, row says *waiting for sidecar* | Backoff after an outage (5 s → 5 min). It resumes automatically; restarting the server resets the backoff immediately. |
| Sidecar fails on first start with an SSL / download error | No access to huggingface.co / github.com. Download once on a connected machine and copy `~/.cache/huggingface/hub/models--Xenova--clip-vit-base-patch32` and `~/.cache/memorylane-ai/` over, then set `HF_HUB_OFFLINE=1`. |
| `npm run ai` says *No Python 3.11+ found* | Install Python 3.11–3.13 (`brew install python@3.12` / `winget install Python.Python.3.12`, ticking "Add to PATH"), open a new terminal, run again. |
| Windows: `npm run ai` compiles something during install | It shouldn't — all deps are prebuilt for 3.11–3.13 x64. Check the Python it picked (printed on the first line) isn't 3.14+ or 32-bit. |
| Port 4280/4281 in use | `MEMORYLANE_PORT`, `MEMORYLANE_AI_PORT` (+ `MEMORYLANE_AI_URL` on the server). |
| Want to start over | Stop both processes, delete the data directory (§5), start again, rescan. Photos are never touched. |

Logs: both processes log to their own terminal.

---

## 10. Open items before calling the release "done"

- Merge order: PR #1 (EXIF/Reports) → #2 (Stacks) → #3 (AI) → #4 (People). Each retargets to `main` automatically as the previous one merges.
- Run the §7 checklist on a Windows machine and record results.
- Validate the native tray, signed installer, update handoff, and plugin onboarding on both operating systems.
- The optional Phase 5 (LLM captions/keywords) is not started — see the design doc §11.
