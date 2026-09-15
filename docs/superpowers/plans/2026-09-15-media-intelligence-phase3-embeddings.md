# Media Intelligence Phase 3 (Sidecar, Embeddings, Similarity, Stacks v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the first model: a local inference sidecar producing CLIP image/text embeddings, a rebuildable vector index, "Find similar", semantic text search, and embedding-refined stacking — with the app fully functional (and unchanged) when no sidecar is running.

**Architecture:** `memorylane-ai/` is a stateless Python/FastAPI service running the pre-exported ONNX CLIP ViT-B/32 (`Xenova/clip-vit-base-patch32`) through `onnxruntime`: JPEG bytes in, L2-normalised 512-d vectors out. The Node server talks to it through a `SidecarProvider` behind the `ImageEmbeddingProvider`/`TextEmbeddingProvider` interfaces. An `embed_image` analyzer on the existing `AnalysisWorker` embeds each media item's thumbnail and writes the vector to `media_embeddings` (SQLite, durable) and to a LanceDB `VectorIndex` (rebuildable ANN cache under `<data>/vectors/`). Provider outages put rows back to pending with exponential backoff instead of failing them. Similarity and semantic search are kNN over the index; stacks v2 adds cosine similarity as a second visual signal next to pHash.

**Tech Stack:** Python ≥ 3.11 (verified on 3.13), FastAPI, uvicorn, onnxruntime 1.30, tokenizers, Pillow, numpy, huggingface_hub; Node: `@lancedb/lancedb@0.33.0` (last line supporting Node 20), undici `fetch`/`FormData` (Node 20 built-ins).

**Spec:** design doc §6.3, 6.3a, 6.5, 8.4, 9, 12, 13 (Phase 3 row), 15, 16.

**Branch:** `feature/media-intelligence-phase3-embeddings` from the Phase 2 branch; PR targets Phase 2 until #2 merges.

## Global Constraints

- The sidecar never receives file paths or touches the DB (design §6.5, §16). Bearer token optional; default bind 127.0.0.1.
- Vectors from different models are never compared: every vector carries its model id; the index space is `media:<model>`.
- SQLite `media_embeddings` is the source of truth; the Lance table is a cache that can be deleted and rebuilt. Startup checks row counts and rebuilds on mismatch.
- No sidecar reachable ⇒ nothing fails: `embed_image` rows stay `pending` with backoff, Find Similar / semantic search return a clear 503, Stacks keep working on pHash alone.
- Measured on this machine (M2 Max): CPU EP 52 img/s, CoreML (MLProgram) 55 img/s, CoreML NeuralNetwork format **fails** on this graph. Default device is therefore CPU; `MEMORYLANE_AI_DEVICE=coreml|cuda|cpu|auto` (auto = cuda if present, else cpu).
- Embedding input is the existing 500 px thumbnail (CLIP downsamples to 224 px); the 1600 px analysis render from design §6.4 is deferred to Phase 4 (faces need it, embeddings don't). Design doc updated in Task 10.
- Same commit/trailer/shared-rebuild rules as earlier phases.

## File Structure

**Sidecar — create `memorylane-ai/`**
- `pyproject.toml` — package `memorylane_ai`, deps, `memorylane-ai` console script.
- `memorylane_ai/config.py` — env → `Settings` (host, port, model repo, device, token, max batch).
- `memorylane_ai/clip_model.py` — `ClipModel`: download via `huggingface_hub`, ONNX sessions, preprocessing, `embed_images(list[bytes])`, `embed_texts(list[str])`, `info()`.
- `memorylane_ai/main.py` — FastAPI app + routes + auth dependency; `__main__.py` runs uvicorn.
- `tests/test_contract.py` — pytest over `TestClient` (downloads the model on first run).
- `README.md`, `Dockerfile`, `.gitignore`.

**Server — create**
- `server/migrations/018_media_embeddings.sql`
- `server/src/providers/types.ts` — provider interfaces, `ProviderUnavailableError`, `ProviderInfo`.
- `server/src/providers/sidecar-provider.ts` — HTTP client.
- `server/src/providers/index.ts` — `createProvider()` from env.
- `server/src/vectors/vector-index.ts` — `VectorIndex` interface + `spaceFor(model)`.
- `server/src/vectors/lance-vector-index.ts` — LanceDB implementation.
- `server/src/vectors/embedding-repo.ts` — `media_embeddings` access + Float32 ↔ BLOB.
- `server/src/analysis/analyzers/embed-image.ts`
- `server/src/api/similar-routes.ts` — `GET /api/media/:id/similar`.
- Tests: `server/test/helpers/fake-sidecar.ts`, `server/test/providers/sidecar-provider.test.ts`, `server/test/vectors/lance-vector-index.test.ts`, `server/test/vectors/embedding-repo.test.ts`, `server/test/analysis/embed-image.test.ts`, `server/test/api/similar-search.test.ts`; additions to `stacker.test.ts`, `stack-service.test.ts`, `analysis-worker.test.ts`.

**Server — modify**: `analysis/types.ts` (`isEnabled?`), `analysis/analysis-worker.ts` (backoff + unclaim + provider status), `analysis/analysis-repo.ts` (`unclaim`), `analysis/registry.ts`, `stacks/stacker.ts` + `stack-service.ts` (v2), `api/search-routes.ts` (semantic mode), `api/settings-routes.ts`, `db/settings-repo.ts`, `context.ts`, `server.ts`, `app.ts`, `config/paths.ts` (`vectorsDir`), `test/helpers/app.ts`.

**Shared — modify**: `types.ts` (`ProviderStatusDto`, `AnalysisStatusDto.provider`, `SimilarResultDto`, `SearchResultDto.score`, settings `aiEnabled`/`stackMinCosine`), `validation.ts` (`searchQuerySchema.mode`, `similarQuerySchema`, settings fields).

**Client — create/modify**: `pages/SimilarPage.tsx` (new), `components/Viewer.tsx` (Find similar button), `pages/SearchPage.tsx` (mode toggle + semantic results grid), `pages/SettingsPage.tsx` (AI section), `App.tsx`, `api/client.ts`.

**Docs**: design doc deltas, `CLAUDE.md`, `README.md` (AI features + running the sidecar).

---

### Task 1: Sidecar service

**Files:** everything under `memorylane-ai/` listed above.

**Interfaces (HTTP contract, design §6.5):**
| Endpoint | Request | Response |
|---|---|---|
| `GET /v1/health` | – | `{ ok: true, device: "cpu"|"coreml"|"cuda", providers: string[], models: { image_embed: { id, dim }, text_embed: { id, dim } }, max_batch: 32 }` |
| `POST /v1/embed/image` | multipart `files` (1–32 JPEG/PNG) | `{ model, dim, vectors: number[][] }` L2-normalised |
| `POST /v1/embed/text` | JSON `{ texts: string[] }` (1–64) | same shape |
| any | header `Authorization: Bearer <token>` when `MEMORYLANE_AI_TOKEN` is set | 401 otherwise |

Model id reported as `clip-vit-base-patch32` (repo name minus org, plus `@1`): `"clip-vit-base-patch32@1"`.

- [ ] **Step 1: Package + config**
```toml
# memorylane-ai/pyproject.toml
[project]
name = "memorylane-ai"
version = "0.1.0"
description = "Local inference sidecar for MemoryLane: image/text embeddings (faces in a later phase)."
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115", "uvicorn[standard]>=0.30", "onnxruntime>=1.20", "numpy>=1.26",
  "pillow>=10", "tokenizers>=0.19", "huggingface_hub>=0.24", "python-multipart>=0.0.9",
]
[project.optional-dependencies]
dev = ["pytest>=8", "httpx>=0.27"]
[project.scripts]
memorylane-ai = "memorylane_ai.__main__:main"
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"
[tool.setuptools.packages.find]
include = ["memorylane_ai*"]
```
```python
# memorylane-ai/memorylane_ai/config.py
import os
from dataclasses import dataclass

@dataclass(frozen=True)
class Settings:
    host: str = os.environ.get("MEMORYLANE_AI_HOST", "127.0.0.1")
    port: int = int(os.environ.get("MEMORYLANE_AI_PORT", "4281"))
    model_repo: str = os.environ.get("MEMORYLANE_AI_MODEL", "Xenova/clip-vit-base-patch32")
    # cpu (default: fastest reliable choice measured on Apple Silicon), coreml, cuda, auto
    device: str = os.environ.get("MEMORYLANE_AI_DEVICE", "cpu")
    token: str | None = os.environ.get("MEMORYLANE_AI_TOKEN") or None
    max_batch: int = int(os.environ.get("MEMORYLANE_AI_MAX_BATCH", "32"))
```

- [ ] **Step 2: Model wrapper**
```python
# memorylane-ai/memorylane_ai/clip_model.py
import io
from dataclasses import dataclass
import numpy as np
import onnxruntime as ort
from PIL import Image
from huggingface_hub import snapshot_download
from tokenizers import Tokenizer

MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
SIZE = 224
CONTEXT = 77
EOS = 49407

def _providers(device: str) -> list:
    available = ort.get_available_providers()
    if device == "auto":
        device = "cuda" if "CUDAExecutionProvider" in available else "cpu"
    if device == "cuda" and "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    if device == "coreml" and "CoreMLExecutionProvider" in available:
        # The default NeuralNetwork format fails on this graph; MLProgram works.
        return [("CoreMLExecutionProvider", {"ModelFormat": "MLProgram", "MLComputeUnits": "ALL"}), "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]

@dataclass(frozen=True)
class ModelInfo:
    id: str
    dim: int
    device: str
    providers: list[str]

class ClipModel:
    def __init__(self, repo: str, device: str = "cpu"):
        path = snapshot_download(repo, allow_patterns=["onnx/vision_model.onnx", "onnx/text_model.onnx", "*.json", "*.txt"])
        providers = _providers(device)
        self.vision = ort.InferenceSession(f"{path}/onnx/vision_model.onnx", providers=providers)
        self.text = ort.InferenceSession(f"{path}/onnx/text_model.onnx", providers=providers)
        self.tokenizer = Tokenizer.from_file(f"{path}/tokenizer.json")
        self.tokenizer.enable_padding(pad_id=EOS, pad_token="<|endoftext|>", length=CONTEXT)
        self.tokenizer.enable_truncation(CONTEXT)
        dim = self.vision.get_outputs()[0].shape[-1]
        used = self.vision.get_providers()[0]
        resolved = "cuda" if "CUDA" in used else "coreml" if "CoreML" in used else "cpu"
        self.info = ModelInfo(id=f"{repo.split('/')[-1]}@1", dim=int(dim), device=resolved, providers=list(self.vision.get_providers()))

    @staticmethod
    def _preprocess(data: bytes) -> np.ndarray:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        w, h = img.size
        s = SIZE / min(w, h)
        img = img.resize((max(SIZE, round(w * s)), max(SIZE, round(h * s))), Image.BICUBIC)
        w, h = img.size
        left, top = (w - SIZE) // 2, (h - SIZE) // 2
        img = img.crop((left, top, left + SIZE, top + SIZE))
        arr = (np.asarray(img, dtype=np.float32) / 255.0 - MEAN) / STD
        return arr.transpose(2, 0, 1)

    @staticmethod
    def _normalize(x: np.ndarray) -> np.ndarray:
        return x / np.clip(np.linalg.norm(x, axis=1, keepdims=True), 1e-12, None)

    def embed_images(self, images: list[bytes]) -> np.ndarray:
        batch = np.stack([self._preprocess(b) for b in images]).astype(np.float32)
        return self._normalize(self.vision.run(None, {"pixel_values": batch})[0])

    def embed_texts(self, texts: list[str]) -> np.ndarray:
        enc = self.tokenizer.encode_batch(texts)
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        return self._normalize(self.text.run(None, {"input_ids": ids})[0])
```

- [ ] **Step 3: App**
```python
# memorylane-ai/memorylane_ai/main.py
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field
from .config import Settings
from .clip_model import ClipModel

settings = Settings()
state: dict = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    state["model"] = ClipModel(settings.model_repo, settings.device)
    yield

app = FastAPI(title="memorylane-ai", lifespan=lifespan)

def require_token(authorization: str | None = Header(default=None)) -> None:
    if settings.token and authorization != f"Bearer {settings.token}":
        raise HTTPException(status_code=401, detail="Invalid or missing token")

class TextRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=64)

def model() -> ClipModel:
    return state["model"]

@app.get("/v1/health")
def health(_: None = Depends(require_token)):
    info = model().info
    return {"ok": True, "device": info.device, "providers": info.providers, "max_batch": settings.max_batch,
            "models": {"image_embed": {"id": info.id, "dim": info.dim}, "text_embed": {"id": info.id, "dim": info.dim}}}

@app.post("/v1/embed/image")
async def embed_image(files: list[UploadFile] = File(...), _: None = Depends(require_token)):
    if not 1 <= len(files) <= settings.max_batch:
        raise HTTPException(status_code=400, detail=f"Send between 1 and {settings.max_batch} files")
    data = [await f.read() for f in files]
    try:
        vectors = model().embed_images(data)
    except Exception as exc:  # undecodable image etc.
        raise HTTPException(status_code=422, detail=f"Could not process an image: {exc}") from exc
    info = model().info
    return {"model": info.id, "dim": info.dim, "vectors": vectors.tolist()}

@app.post("/v1/embed/text")
def embed_text(req: TextRequest, _: None = Depends(require_token)):
    vectors = model().embed_texts(req.texts)
    info = model().info
    return {"model": info.id, "dim": info.dim, "vectors": vectors.tolist()}
```
```python
# memorylane-ai/memorylane_ai/__main__.py
import uvicorn
from .config import Settings

def main() -> None:
    s = Settings()
    uvicorn.run("memorylane_ai.main:app", host=s.host, port=s.port, log_level="info")

if __name__ == "__main__":
    main()
```
`memorylane_ai/__init__.py` empty. `.gitignore`: `.venv/`, `__pycache__/`, `*.egg-info/`.

- [ ] **Step 4: Contract tests**
```python
# memorylane-ai/tests/test_contract.py
import io, math
import numpy as np
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from memorylane_ai.main import app

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c

def jpeg(color, size=(320, 240)) -> bytes:
    buf = io.BytesIO(); Image.new("RGB", size, color).save(buf, format="JPEG"); return buf.getvalue()

def test_health(client):
    r = client.get("/v1/health"); assert r.status_code == 200
    body = r.json(); assert body["ok"] and body["models"]["image_embed"]["dim"] == 512
    assert body["models"]["image_embed"]["id"] == "clip-vit-base-patch32@1"

def test_embed_images_shape_and_norm(client):
    r = client.post("/v1/embed/image", files=[("files", ("a.jpg", jpeg((220, 30, 30)), "image/jpeg")), ("files", ("b.jpg", jpeg((30, 30, 220)), "image/jpeg"))])
    assert r.status_code == 200
    v = np.array(r.json()["vectors"]); assert v.shape == (2, 512)
    assert all(math.isclose(float(np.linalg.norm(row)), 1.0, abs_tol=1e-4) for row in v)
    assert r.json()["model"] == "clip-vit-base-patch32@1"

def test_text_matches_image(client):
    img = np.array(client.post("/v1/embed/image", files=[("files", ("r.jpg", jpeg((220, 30, 30)), "image/jpeg"))]).json()["vectors"][0])
    txt = np.array(client.post("/v1/embed/text", json={"texts": ["a red square", "a photo of a dog"]}).json()["vectors"])
    sims = txt @ img
    assert sims[0] > sims[1]

def test_rejects_bad_image_and_empty_batch(client):
    assert client.post("/v1/embed/image", files=[("files", ("x.jpg", b"not an image", "image/jpeg"))]).status_code == 422
    assert client.post("/v1/embed/text", json={"texts": []}).status_code == 422
```

- [ ] **Step 5: README + Dockerfile** — README: purpose, one-paragraph install (`python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && .venv/bin/memorylane-ai`), env vars table, endpoints, `MEMORYLANE_AI_URL` on the server side, GPU notes (CUDA on Windows/Linux, CoreML opt-in), Docker (`docker build -t memorylane-ai . && docker run -p 4281:4281 -v hf:/root/.cache/huggingface memorylane-ai`). Dockerfile: `python:3.12-slim`, `pip install .`, `ENV MEMORYLANE_AI_HOST=0.0.0.0`, `CMD ["memorylane-ai"]`.

- [ ] **Step 6: Run** `cd memorylane-ai && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && .venv/bin/pytest -q` → 4 passed. Commit: `feat(ai): memorylane-ai sidecar with CLIP image/text embeddings`.

---

### Task 2: Server foundations — migration, `EmbeddingRepo`, provider interfaces + `SidecarProvider`, fake sidecar for tests

**Files:** `server/migrations/018_media_embeddings.sql`, `server/src/vectors/embedding-repo.ts`, `server/src/providers/{types,sidecar-provider,index}.ts`, `server/test/helpers/fake-sidecar.ts`, tests.

- [ ] **Step 1: Migration**
```sql
-- Image/text embeddings (design doc §9). Durable home of every vector; the
-- LanceDB index under <data-dir>/vectors is a rebuildable cache over this.
-- One row per (media, model) so a model change never mixes spaces.
CREATE TABLE media_embeddings (
  media_id   INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  model      TEXT    NOT NULL,
  dim        INTEGER NOT NULL,
  vector     BLOB    NOT NULL, -- float32[dim], L2-normalised, little-endian
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (media_id, model)
);
CREATE INDEX idx_media_embeddings_model ON media_embeddings(model);
```

- [ ] **Step 2: EmbeddingRepo**
```ts
export function vectorToBlob(v: Float32Array): Buffer      // Buffer.from(v.buffer, v.byteOffset, v.byteLength) copy
export function blobToVector(b: Buffer): Float32Array
export class EmbeddingRepo {
  constructor(db)
  upsertMany(model: string, rows: { mediaId: number; vector: Float32Array }[]): void   // one transaction
  get(mediaId: number, model: string): Float32Array | null
  count(model: string): number
  *iterate(model: string): Generator<{ id: number; vector: Float32Array }>             // ORDER BY media_id
  deleteModel(model: string): number
}
```
Test: round-trip a vector, count/iterate order, upsert overwrites.

- [ ] **Step 3: Provider interfaces**
```ts
// server/src/providers/types.ts
export class ProviderUnavailableError extends Error {}   // network/5xx/model mismatch → back off, don't fail rows
export interface ProviderInfo { url: string; reachable: boolean; model: string | null; dim: number | null; device: string | null; lastError: string | null; checkedAt: string | null }
export interface ImageEmbeddingProvider { readonly id: string; expectedModel: string; embedImages(jpegs: Buffer[]): Promise<{ model: string; dim: number; vectors: Float32Array[] }> }
export interface TextEmbeddingProvider { embedText(texts: string[]): Promise<{ model: string; dim: number; vectors: Float32Array[] }> }
export interface EmbeddingProvider extends ImageEmbeddingProvider, TextEmbeddingProvider { health(force?: boolean): Promise<ProviderInfo>; getInfo(): ProviderInfo }
```
`SidecarProvider(url, opts: { token?: string; expectedModel: string; healthTtlMs?: number })`:
- `health(force)` — GET `/v1/health` (5 s timeout via `AbortSignal.timeout`), cached for `healthTtlMs` (default 30 s); on success sets `reachable`, `model`, `dim`, `device`; if `model !== expectedModel` → `reachable=false`, `lastError="Sidecar model X does not match configured Y"`.
- `embedImages` — `FormData` with `new Blob([buf], { type: "image/jpeg" })` appended as `files`; POST `/v1/embed/image`; 30 s timeout; non-2xx 5xx / network → `ProviderUnavailableError`; 4xx → plain `Error` (caller marks failed); response `model` must equal `expectedModel` else `ProviderUnavailableError`.
- `embedText` — POST JSON.
- `createProvider(env = process.env): EmbeddingProvider | null` — `MEMORYLANE_AI_PROVIDER` (`sidecar` default | `none`), `MEMORYLANE_AI_URL` (default `http://127.0.0.1:4281`), `MEMORYLANE_AI_TOKEN`, `MEMORYLANE_AI_MODEL` (default `clip-vit-base-patch32@1`).

- [ ] **Step 4: Fake sidecar test helper** — a Fastify instance on `127.0.0.1:0` implementing the contract with deterministic vectors: image vector = normalised histogram-ish of byte values (so identical bytes ⇒ identical vector, different ⇒ different); text vector = normalised hash of the words; both dim 8 (configurable); `model` configurable (default `clip-vit-base-patch32@1`); switches `failing` / `down` (close server) for backoff tests. Exposes `{ url, model, setFailing(), close() }`. Multipart parsing via `@fastify/multipart`? Not a dependency — instead accept `application/octet-stream`? No: the provider must send real multipart. Use Node's `request.raw` and a tiny boundary parser in the helper (split on `--boundary`, take parts after the blank line) — 25 lines, test-only.

- [ ] **Step 5: Provider tests** — health caches and reports `reachable`; model mismatch → unreachable + `lastError`; `embedImages` returns `Float32Array`s of dim 8 in order; network down → `ProviderUnavailableError`; 422 → plain Error; `createProvider({ MEMORYLANE_AI_PROVIDER: "none" })` → null.

Run tests → PASS. Commit: `feat(ai): media_embeddings, provider interfaces and SidecarProvider`.

---

### Task 3: `VectorIndex` + `LanceVectorIndex`

**Files:** `server/src/vectors/vector-index.ts`, `server/src/vectors/lance-vector-index.ts`, `server/src/config/paths.ts` (`vectorsDir`), `server/package.json` (`@lancedb/lancedb@0.33.0`), `server/test/vectors/lance-vector-index.test.ts`.

**Interfaces (design §6.3a):**
```ts
export function spaceFor(kind: "media", model: string): string   // "media:clip-vit-base-patch32@1" → table name sanitised: media__clip-vit-base-patch32_1
export interface VectorHit { id: number; score: number }           // score = cosine similarity in [-1, 1]
export interface VectorIndex {
  upsert(space: string, rows: { id: number; vector: Float32Array }[]): Promise<void>;
  remove(space: string, ids: number[]): Promise<void>;
  search(space: string, query: Float32Array, k: number, opts?: { excludeIds?: number[] }): Promise<VectorHit[]>;
  count(space: string): Promise<number>;
  rebuild(space: string, rows: Iterable<{ id: number; vector: Float32Array }>, dim: number): Promise<void>;
  ensureSynced(space: string, expectedCount: number, rows: () => Iterable<{ id: number; vector: Float32Array }>, dim: number): Promise<"ok" | "rebuilt">;
}
```
`LanceVectorIndex(dir)`: `connect(dir)` lazily; table per space with schema `{ id: Int64, vector: FixedSizeList<Float32>(dim) }`; `upsert` = `mergeInsert("id").whenMatchedUpdateAll().whenNotMatchedInsertAll()` (available in 0.33) — verify, else delete+add; `search` = `vectorSearch(q).distanceType("cosine").limit(k + exclude.length)` then filter excluded and map `score = 1 - _distance`; `count` returns 0 for a missing table; `rebuild` = `createTable(name, rows, { mode: "overwrite" })` in chunks of 5 000 (`add` after the first chunk); `ensureSynced` compares counts. Index creation (`createIndex("vector", { config: Index.ivfPq(...) })`) only when count ≥ 50 000 — skipped in Phase 3 tests; flat search is fine below that.

Tests (temp dir): upsert 200 random unit vectors → search returns self first with score ≈ 1; excludeIds honoured; upsert same id updates; remove; count on missing space = 0; rebuild overwrites; ensureSynced returns "rebuilt" on mismatch then "ok".

Commit: `feat(vectors): LanceDB-backed VectorIndex`.

---

### Task 4: `embed_image` analyzer + worker backoff + registry/context wiring

**Files:** `analysis/analyzers/embed-image.ts`, `analysis/types.ts`, `analysis/analysis-repo.ts`, `analysis/analysis-worker.ts`, `analysis/registry.ts`, `context.ts`, `server.ts`, `test/helpers/app.ts`, `shared/src/types.ts`, tests.

- [ ] **Step 1: Types/DTOs** — `Analyzer.isEnabled?: () => boolean` (worker skips when false). Shared:
```ts
export interface ProviderStatusDto { url: string; reachable: boolean; model: string | null; dim: number | null; device: string | null; lastError: string | null; checkedAt: string | null }
// AnalysisStatusDto gains:  provider: ProviderStatusDto | null;
// AnalyzerStatusDto gains:  backoffUntil: string | null;
// SettingsDto/UpdateSettingsRequest gain: aiEnabled: boolean; stackMinCosine: number;   (defaults true, 0.9; schema min 0.5 max 1)
```

- [ ] **Step 2: Repo + worker** — `AnalysisRepo.unclaim(analyzerKey, mediaIds)` sets `running → pending` without touching `attempts`. Worker: `private backoff = new Map<string, { until: number; delayMs: number }>()`; in `runOnce`, skip analyzers whose `isEnabled?.() === false` or whose backoff `until > Date.now()`; in the `catch`, if `err instanceof ProviderUnavailableError` → `repo.unclaim(a.key, ids)`, `delayMs = min(prev*2 || 5000, 300000)`, `until = now + delayMs`, `logger.warn` once per escalation, and do **not** count those rows in `processed`; on a successful batch reset the analyzer's backoff. `getStatus()` includes `backoffUntil` per analyzer and `provider: this.provider?.getInfo() ?? null` (worker gets `opts.provider?: EmbeddingProvider`).

- [ ] **Step 3: Analyzer**
```ts
export const EMBED_IMAGE_KEY = "embed_image";
export function createEmbedImageAnalyzer(db, paths, provider: EmbeddingProvider, index: VectorIndex, isEnabled: () => boolean): Analyzer
```
- `version = provider.expectedModel`; `batchSize = 16`; `appliesTo = "thumbnail_status = 'done'"` (photos, RAW previews' thumbnails, video posters — all get a vector; text search over video posters is useful); `isEnabled`.
- `run(rows)`: `await provider.health()` — if `!reachable` throw `ProviderUnavailableError(lastError)`; read each thumbnail (`thumbnailPathForMediaId`), missing → `unsupported`; `provider.embedImages(buffers)`; `EmbeddingRepo.upsertMany(model, …)`; `index.upsert(spaceFor("media", model), …)`; `markFoldersDirty(db, folders)` (stacks v2); return outcomes.
- Test with the fake sidecar + temp Lance dir: 3 seeded media with real thumbnail files (write tiny JPEGs via sharp into a temp thumbnails dir) → `done`, embeddings count 3, index count 3; sidecar down → `ProviderUnavailableError` propagates; worker test: rows return to pending, `attempts` unchanged, `backoffUntil` set, next `runOnce` skips.

- [ ] **Step 4: Wiring** — `paths.vectorsDir = <data>/vectors` (mkdir); `AppContext` gains `provider: EmbeddingProvider | null`, `vectorIndex: VectorIndex`, `embeddings: EmbeddingRepo`; `server.ts`: `createProvider()`, `new LanceVectorIndex(paths.vectorsDir)`, registry gets `{ provider, index, settingsRepo }` and appends `embed_image` only when `provider` is non-null; after `analysisWorker.start()`: `if (provider) void vectorIndex.ensureSynced(space, embeddings.count(model), () => embeddings.iterate(model), dim?)` — dim from the first stored vector (skip when count is 0); log "rebuilt" when it happens. `test/helpers/app.ts`: `provider: null`, `vectorIndex: new LanceVectorIndex(tmp)`, `embeddings: new EmbeddingRepo(db)`; add `withProvider(fake)` option.

Run tests → PASS. Commit: `feat(ai): embed_image analyzer with provider backoff`.

---

### Task 5: Find Similar + semantic search (API)

**Files:** `server/src/api/similar-routes.ts`, `server/src/api/search-routes.ts`, `shared/src/{types,validation}.ts`, `app.ts`, `server/test/api/similar-search.test.ts`.

- Shared: `similarQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(48) })`; `searchQuerySchema.extend({ mode: z.enum(["text", "semantic"]).default("text") })`; `SearchResultDto.score?: number`; `SimilarResultDto { source: MediaDto; items: { media: MediaDto; score: number }[] }`.
- `GET /api/media/:id/similar?limit` — 404 unknown media; 503 `{ error: "AI features are not available - no embedding provider" }` when `ctx.provider` null; 409 `{ error: "This photo hasn't been analysed yet" }` when no embedding; else `index.search(space, vec, limit, { excludeIds: [id] })` → fetch rows via `buildMediaQuery({ scope: { kind: "ids", ids } })` (companions hidden, stacks not collapsed) → order by score → `decorateMedia`.
- `GET /api/search?mode=semantic` — 503 when no provider; `provider.embedText([q])` (`ProviderUnavailableError` → 503 with the provider's `lastError`); `index.search(space, vec, limit + offset)` → slice → rows → `{ type: "media", media, score }`; `total = items.length`. Text mode unchanged.
- Tests: with fake provider + seeded embeddings (write vectors straight into repo + index): similar returns the nearest others in score order and excludes self and a paired RAW; semantic search returns items with scores; both 503 without provider; 409 for un-analysed media.

Commit: `feat(ai): find-similar and semantic search endpoints`.

---

### Task 6: Stacks v2

**Files:** `stacks/stacker.ts`, `stacks/stack-service.ts`, `db/settings-repo.ts`, `api/settings-routes.ts`, tests.

- `StackCandidate.embedding: Float32Array | null`; `StackerOptions.minCosine: number` (default 0.9); `similar = hashClose || (both embeddings && cosine(a, b) >= minCosine)`; `STACK_RULE_VERSION = "burst-v2"`; export `cosine(a, b)`.
- `listCandidates` joins `LEFT JOIN media_embeddings me ON me.media_id = media.id AND me.model = ?` (model = `ctx.provider?.expectedModel ?? ""`; `StackService` gets an optional `getModel: () => string | null` ctor arg) and maps `vector` blobs via `blobToVector`.
- `StackService.hasStaleAutoStacks()`: `SELECT 1 FROM stacks WHERE user_modified = 0 AND rule_version != ? LIMIT 1`; `server.ts` calls `markAllDirty()` when true (one-time v1 → v2 refresh).
- Settings: `stackMinCosine` default 0.9 (schema 0.5–1); settings route also marks all dirty when it changes.
- Tests: stacker — far hashes but cosine 0.95 ⇒ grouped; cosine 0.8 ⇒ not; missing embedding on one side falls back to hash rule. Service — candidates include embeddings when a model is configured.

Commit: `feat(stacks): v2 grouping with embedding similarity`.

---

### Task 7: Settings, status, and `aiEnabled`

**Files:** `db/settings-repo.ts`, `api/settings-routes.ts`, `analysis/registry.ts`, `SettingsPage.tsx`, `client.ts`.

- `aiEnabled` (default true) → `embed_image.isEnabled = () => settingsRepo.getAll().aiEnabled`.
- `GET /api/analysis/status` now carries `provider` and `backoffUntil` (Task 4).
- Client Settings › **AI** section (before Stacks): toggle "Use the local AI sidecar for similarity, semantic search and smarter stacks"; provider card: URL, `Connected · clip-vit-base-patch32@1 · cpu` or `Not reachable — <lastError>` with a short "How to run it" line linking to `memorylane-ai/README.md`; `embed_image` row appears in the Analysis table automatically. Stacks section gets the `Visual similarity (min cosine)` input.

Commit: `feat(settings): AI provider status and toggle`.

---

### Task 8: Client — Similar page, Viewer button, semantic search

**Files:** `pages/SimilarPage.tsx`, `components/Viewer.tsx`, `pages/SearchPage.tsx`, `App.tsx`, `api/client.ts`.

- `api.media.similar(id, limit)`, `api.search(q, offset, limit, mode)`, `api.analysis.status()` already exists.
- **Viewer**: a `Sparkles` control at `top-3 right-16` ("Find similar") that calls `onClose()` then `navigate(`/similar/${current.id}`)`. Shown only when `aiAvailable` — Viewer gets an optional prop? Simpler: always shown; the Similar page explains when AI is unavailable (503 → message with link to Settings).
- **SimilarPage** (`/similar/:id`): source thumbnail + filename + "Back"; grid of results (MediaGrid) with a small score chip ("92%") drawn by passing `items` with… MediaGrid has no score slot — render the score as a tiny overlay via a new optional `MediaGrid` prop `captions?: Record<number, string>` (bottom-left text chip). Viewer over the result list. 409 → "Not analysed yet — the AI queue is still working through your library (Settings › Analysis)". 503 → "AI features are off or the sidecar isn't running".
- **SearchPage**: segmented toggle `Filenames | Describe it (AI)`; placeholder changes ("a bird taking off from water…"); semantic results render as a MediaGrid with score captions + Viewer; 503 shows the explanation inline and flips back to text mode.

Typecheck + build clean. Commit: `feat(client): find similar, semantic search, AI settings`.

---

### Task 9: End-to-end verification

1. `cd memorylane-ai && .venv/bin/memorylane-ai` (port 4281) — health reports `clip-vit-base-patch32@1 · cpu`.
2. Fixture library (Phase 2 burst fixture + a distinctly coloured "sunset" image + a "blue sky" image) → scan → wait: `embed_image` done = N; `media_embeddings` count = N; `vectors/` table count = N (log line).
3. API: `GET /api/media/<burst frame>/similar` → the other burst frames first with score > 0.95, the different-composition frame lower; `GET /api/search?q=red&mode=semantic` ranks the red image first; stop the sidecar → similar returns 503, `analysis/status.provider.reachable=false`, pending rows stay pending with `backoffUntil` set; start it → they drain.
4. Rebuild: delete `<data>/vectors/`, restart → log "rebuilt", similar works again.
5. Browser: Viewer → Find similar → Similar page shows results with score chips; Search → Describe it → results grid; Settings › AI shows connected/model/device, toggle off pauses `embed_image` (status shows it skipped); Stacks section has min-cosine; zero console errors.

### Task 10: Docs + PR

- Design doc: §6.4 note (thumbnail input for embeddings in Phase 3; 1600 px render deferred to faces), §6.5 (model = CLIP ViT-B/32 ONNX via `Xenova/clip-vit-base-patch32`; CPU default with measured numbers; CoreML opt-in), §6.3a (LanceDB 0.33 pin, Node 20), §16 (Python 3.11–3.13 verified on 3.13).
- `CLAUDE.md`: "AI sidecar & embeddings" section (how to run, env vars, provider/backoff semantics, index rebuild, spaces), commands (`memorylane-ai` venv + pytest).
- `README.md`: "AI features (optional)" section.
- PR against `feature/media-intelligence-phase2-stacks`.

## Self-review

§6.3 provider interface ✔ (T2, image+text on one provider; `CloudProvider` not built — as designed). §6.3a `VectorIndex` ✔ (T3; IVF-PQ deferred below 50k rows, documented). §6.5 contract ✔ (T1; `/v1/faces` and `/v1/cluster` are Phase 4). §9 tables/kNN/similar/semantic ✔ (T2, T5). §8.4 stacks v2 ✔ (T6, `rule_version` bump re-queues auto stacks). §6.2 backoff ✔ (T4: 5 s → 5 min, rows never marked failed by outages). §12 settings ✔ (T7). §16 platform ✔ (no paths cross the boundary; Docker file). Deviation recorded: thumbnail instead of 1600 px input for embeddings (T10 doc update).
