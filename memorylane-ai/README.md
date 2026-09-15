# memorylane-ai

Optional local inference sidecar for MemoryLane. It turns images and short texts into vectors (CLIP ViT-B/32, ONNX) so the app can offer **Find similar**, **describe-it search**, and smarter burst stacks. Everything stays on your machine; the sidecar never sees file paths or the database - the server sends it JPEG bytes and gets numbers back.

Without it, MemoryLane works exactly as before; those three features simply show as unavailable.

## Run it

From the repo root, on any OS:

```bash
npm run ai
```

That finds a Python 3.11+, creates `.venv` here, installs on first run, and starts the service. Manual equivalent (Python 3.11+, tested on 3.13; the first start downloads the model, ~350 MB):

macOS / Linux:

```bash
cd memorylane-ai
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/memorylane-ai
```

Windows (python.org installer):

```powershell
cd memorylane-ai
py -m venv .venv
.venv\Scripts\pip install -e .
.venv\Scripts\memorylane-ai
```

Docker:

```bash
docker build -t memorylane-ai .
docker run -p 4281:4281 -v memorylane-hf:/root/.cache/huggingface memorylane-ai
```

Then start MemoryLane as usual - it looks for the sidecar at `http://127.0.0.1:4281` (change with `MEMORYLANE_AI_URL`). Settings › AI shows whether it's connected.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEMORYLANE_AI_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` to serve another machine on the LAN) |
| `MEMORYLANE_AI_PORT` | `4281` | Port |
| `MEMORYLANE_AI_MODEL` | `Xenova/clip-vit-base-patch32` | Hugging Face repo with an ONNX CLIP export |
| `MEMORYLANE_AI_FACE_MODEL` | `yunet-sface` | Face model for People. `buffalo_l` = InsightFace ArcFace (512-d): noticeably better at telling similar faces apart (siblings, children), ~190 MB extra download, ~60 % slower, and **licensed for non-commercial use only** - opt in for personal libraries. Set `MEMORYLANE_AI_FACE_MODEL=buffalo_l@1` on the MemoryLane server too. |
| `MEMORYLANE_AI_DEVICE` | `cpu` | `cpu`, `cuda`, `dml` (DirectML, Windows), `coreml` (Apple Silicon), or `auto` |
| `MEMORYLANE_AI_TOKEN` | unset | If set, every request must carry `Authorization: Bearer <token>` (set the same value as `MEMORYLANE_AI_TOKEN` on the server) |
| `MEMORYLANE_AI_MAX_BATCH` | `32` | Max images per request |

GPU notes: CPU does ~50 images/s on an M2 Max, which is plenty for a nightly backfill. For NVIDIA install `onnxruntime-gpu` instead of `onnxruntime` and set `MEMORYLANE_AI_DEVICE=cuda`; on Windows without CUDA install `onnxruntime-directml` and use `dml`. On Apple Silicon `coreml` works but is within a few percent of CPU.

## Endpoints

- `GET /v1/health` → device, model ids and dimensions
- `POST /v1/embed/image` (multipart `files`, up to `MAX_BATCH`) → `{ model, dim, vectors }` (L2-normalised)
- `POST /v1/embed/text` (`{ "texts": [...] }`) → same shape

## Tests

```bash
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q
```
