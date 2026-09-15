# Media Intelligence: EXIF Reports, Stacks, and Persons

**Status:** Draft for review — 2026-09-14
**Scope:** Architecture for three related features on one shared analysis pipeline. No code exists yet.

---

## 1. Goals

Photographers with large archives need MemoryLane to do more than browse folders:

1. **Full EXIF capture + reporting.** Keep every tag ExifTool can read, and let the user filter/report across the library: "all photos taken with the 100-400mm", "everything at f/1.4 or wider", "ISO ≥ 6400 on the R5", broken down by lens/body/year.
2. **Stacks.** Modern bodies shoot 20–40 fps. A folder of 3,000 files is often 200 real moments. Detect runs of near-identical shots (same moment, same subject, tiny variation) and collapse them into a *stack* the user can expand, re-cover, split, or merge — so the grid shows moments, not frames.
3. **Persons.** Detect faces, group them into identities, auto-label them "Person 1, Person 2, …", let the user rename/merge/correct, then query "photos of Maya, summer 2019".

Underneath: a **provider-agnostic inference layer** so the models can change (cloud today, self-hosted tomorrow) without touching the features built on top.

## 2. Non-goals (this design)

- Editing, rating-writeback, or writing XMP sidecars. MemoryLane stays read-only over originals.
- Object/scene tagging via an LLM ("beach", "dog"). Optional later analyzer; noted in §11 but not designed here.
- Video content analysis. Videos get a poster-frame embedding only; no face tracking in video.
- Multi-user / per-user persons. The app is single-user; person labels are global.
- Real-time analysis during scan. Analysis is a background, resumable queue that trails the scanner.

## 3. Strategy — the key insight

The request framed this as "cloud LLM first, local models later." For two of the three features that ordering is inverted:

| Need | What actually solves it | Can Claude/OpenAI chat APIs do it? |
|---|---|---|
| Full EXIF | ExifTool (already in the stack) | Not needed |
| Burst/near-duplicate detection | Capture time + camera EXIF + perceptual hash; refined by an **image embedding** (CLIP/SigLIP/DINOv2) | No — they return text, not comparable vectors |
| Face identity | A **face detector + face embedding** (InsightFace/ArcFace) + clustering | No — no embedding output, and identity matching is refused by policy |

The vector-producing models are all open, small (100–400 MB), and run at useful speed on CPU and very fast on Apple Silicon / NVIDIA. So the cheapest, most private path is also the *first* path: a **local inference sidecar** running open models. Cloud LLMs slot in later as an optional *enrichment* analyzer (captions/keywords) where they're actually good, and the provider interface below makes that a plug-in, not a redesign.

Consequences for the design:

- Build the features so that **most value ships before any model runs**: full EXIF needs no AI; stacks v1 is time + EXIF + perceptual hash, all in-process.
- The AI pipeline is **one generic mechanism** (analyzers, jobs, versioned results, a feature store) used by embeddings, faces, and any future analyzer.
- **Sidecar over HTTP on localhost** as the primary inference host (user's decision: server process, sidecar allowed). In-process ONNX is not designed in now but nothing prevents adding it as another provider.

## 4. Current-state constraints this builds on

From the existing codebase (see `CLAUDE.md`):

- Single Node process, Fastify, **synchronous** better-sqlite3 in WAL mode. Long CPU work must stay off the event loop (ExifTool/ffmpeg are already child processes; Sharp is libuv-threaded). Inference must therefore be out-of-process — another reason for the sidecar.
- `processMediaItem` already calls `exiftool.read()` which returns **every** tag; today only ~16 are kept. Full EXIF is mostly a storage change.
- Result-status pattern already exists: `thumbnail_status` + `thumbnail_version`, retried on the next scan when not `done`, invalidated by migrations. The analysis pipeline copies this pattern instead of inventing another.
- `TranscodeWorker` already demonstrates a DB-backed, restart-safe job queue with startup reconciliation. `AnalysisWorker` follows the same shape.
- Companion-hiding is done with SQL fragments appended to every listing (`EXCLUDE_LIVE_PHOTO_VIDEOS`, `EXCLUDE_PAIRED_RAW`). Stacks add a third fragment, and the number of hand-built listing queries (folders, search, favorites, memories, home) is now high enough that a **shared query builder** is warranted (§8.1).
- Derivatives on disk: 500 px thumbnails for everything, 1800 px previews for RAW only. Models want ~640–1600 px inputs; faces need more than 500 px. §6.4 covers the analysis-input tier.
- Desktop tray app bundles a bare Node runtime. The sidecar is **not** part of the tray bundle in this design; the tray app simply works without AI features until a sidecar is reachable (same graceful degradation ExifTool has today).

## 5. Architecture overview

```
                       ┌──────────────────────────────────────────────────────────┐
                       │  MemoryLane server (Node, Fastify, better-sqlite3)        │
                       │                                                          │
   scan ──▶ Scanner ──▶ processMediaItem ──▶ media, media_exif ─┐                 │
                       │        │                                │                 │
                       │        └─ enqueue ──▶ media_analysis (pending rows)      │
                       │                            │                             │
                       │                     AnalysisWorker  (batches, backoff)   │
                       │                       │        │                          │
                       │      in-process analyzers    provider analyzers          │
                       │      (phash, stacks v1)      (embed, faces)              │
                       │                                   │                       │
                       │  feature store: media_embeddings / faces / persons /     │
                       │                 stacks (SQLite)  +  VectorIndex (LanceDB)│
                       │                                   ▲                       │
                       │  MediaQuery builder ◀── /api/media, /api/reports,        │
                       │                          /api/persons, /api/stacks        │
                       └───────────────────────────────┬──────────────────────────┘
                                                       │ HTTP (localhost, multipart JPEG batches)
                                                       ▼
                       ┌──────────────────────────────────────────────────────────┐
                       │  memorylane-ai sidecar (Python, FastAPI, ONNX Runtime)    │
                       │   /v1/health  /v1/embed/image  /v1/embed/text            │
                       │   /v1/faces   /v1/cluster                                │
                       │   models: SigLIP/CLIP image+text, InsightFace buffalo_l  │
                       │   device: CoreML | CUDA | CPU                            │
                       └──────────────────────────────────────────────────────────┘
```

Boundaries:

- **Scanner** discovers files and extracts metadata/thumbnails (existing). It only *enqueues* analysis; it never waits on it.
- **AnalysisWorker** drains `media_analysis`, calls an **Analyzer** per row, records status + model version. Analyzers are either in-process (cheap) or call a **Provider** (sidecar/cloud).
- **Feature store** is plain SQLite tables (durable, transactional with everything else) plus a **VectorIndex** — an embedded LanceDB store under the data dir that is a rebuildable ANN index over the vectors SQLite already holds. No server process; no second source of truth.
- **Domain services** (StackService, PersonService, ReportService) read the feature store and own their rules (grouping thresholds, clustering policy, user-override precedence).
- **MediaQuery builder** is the single place that turns filter parameters (folder, type, person, date range, EXIF facets, collapse-stacks) into SQL, used by every listing route.
- **Sidecar** is stateless: bytes in, vectors/detections out. It never sees file paths or the database, so it can run in Docker or on another machine.

## 6. Shared pipeline

### 6.1 Analyzer registry

```ts
interface Analyzer {
  key: string;                 // "exif_full" | "phash" | "embed_image" | "faces"
  modelVersion: string;        // "exiftool-12.9" | "phash-v1" | "siglip-so400m@1" | "buffalo_l@1"
  appliesTo: (m: MediaRow) => boolean;    // e.g. faces: images + raw only
  requires: AnalyzerKey[];     // ordering; faces requires nothing, stacks_v1 requires phash+exif_full
  run(ctx, batch: MediaRow[]): Promise<AnalyzerResult[]>;   // batch-oriented
}
```

`modelVersion` is stored with every result. Changing it (new model, new prompt, bug fix) makes existing rows stale and re-queued — the same idea as `thumbnail_version` migrations, without needing a migration file.

### 6.2 Job table and worker

```sql
CREATE TABLE media_analysis (
  media_id      INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  analyzer      TEXT    NOT NULL,
  status        TEXT    NOT NULL,          -- pending | running | done | failed | unsupported
  model_version TEXT,                      -- version that produced the current result
  input_fingerprint TEXT,                  -- media.fingerprint at run time; mismatch → re-queue
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  updated_at    TEXT    NOT NULL,
  PRIMARY KEY (media_id, analyzer)
);
CREATE INDEX idx_media_analysis_pending ON media_analysis(analyzer, status);
```

Lifecycle:

- **Enqueue.** After `processMediaItem` finishes (thumbnail done or unsupported), the scanner `INSERT OR IGNORE`s one `pending` row per enabled analyzer whose `appliesTo` matches. On fingerprint change it resets the row to `pending`. Enabling an analyzer in Settings backfills pending rows for all active media.
- **Drain.** `AnalysisWorker` runs continuously (started in `server.ts`, on `AppContext`). For each analyzer in dependency order it pulls `pending` rows in batches (sidecar analyzers: 16–32 per request; in-process: 100), marks them `running`, calls `run`, writes results + `done`/`failed`. Concurrency per analyzer is a setting (default: 1 batch in flight per provider analyzer, 4 for in-process).
- **Backoff.** If the provider is unreachable, the worker sleeps with exponential backoff (5 s → 5 min) and surfaces "AI service unavailable" in status; nothing is marked failed. Per-row failures (corrupt file) increment `attempts`; after 3 the row stays `failed` until a manual retry.
- **Priority.** The worker pauses while a scan is actively generating thumbnails (`scanner.isRunning()`), so the existing pipeline keeps its I/O budget. Resume when idle.
- **Reconcile on startup.** `running` → `pending` (same as `TranscodeWorker.reconcileAndResume`; nothing survives a restart). Rows whose `model_version` ≠ the registered analyzer's version → `pending`.
- **Status API.** `GET /api/analysis/status` returns per-analyzer `{pending, running, done, failed, unsupported, providerReachable, modelVersion}`; the Settings page shows it next to scan status with the same polling cadence.

### 6.3 Provider interface

```ts
interface ImageEmbeddingProvider {
  id: string; modelId: string; dim: number;
  embedImages(jpegs: Buffer[]): Promise<Float32Array[]>;
  embedText?(texts: string[]): Promise<Float32Array[]>;   // enables text→image search for free
}
interface FaceProvider {
  id: string; modelId: string; dim: number;
  detectFaces(jpegs: Buffer[]): Promise<FaceDetection[][]>;
}
interface ClusteringProvider {
  cluster(vectors: Float32Array[], opts: {minClusterSize: number; threshold: number}): Promise<number[]>; // label per vector, -1 = noise
}
```

Implementations:

- `SidecarProvider` implements all three against `MEMORYLANE_AI_URL` (default `http://127.0.0.1:4281`). Health-checked at startup and on backoff; exposes reachable/model info.
- `CloudProvider` (later, optional) — for embeddings it could wrap e.g. a hosted CLIP endpoint; for captions, Claude. Not built in the first phases.
- Selection: `MEMORYLANE_AI_PROVIDER=sidecar|none` + Settings toggles per analyzer. `none` disables all provider analyzers; in-process ones still run.

Vectors from different models are never compared. `media_embeddings.model` is part of every kNN query.

### 6.3a VectorIndex

All nearest-neighbour work goes through one interface so the index technology is swappable and never leaks into feature code:

```ts
interface VectorIndex {
  upsert(space: string, ids: number[], vectors: Float32Array[]): Promise<void>;   // space = "media:siglip@1" | "faces:buffalo_l@1"
  remove(space: string, ids: number[]): Promise<void>;
  search(space: string, query: Float32Array, k: number, filter?: { idsIn?: number[]; idsNotIn?: number[] }): Promise<{ id: number; score: number }[]>;
  rebuild(space: string, source: AsyncIterable<{ id: number; vector: Float32Array }>): Promise<void>;
}
```

Implementation: **LanceDB** (Apache-2.0, `@lancedb/lancedb`, embedded — native prebuilt binaries for macOS/Windows/Linux) storing one table per space under `<data-dir>/vectors/`, with an IVF-PQ index built once a space exceeds ~50k rows (below that, Lance's flat scan is already fast). SQLite remains the durable home of every vector; the Lance tables are a cache in the same sense thumbnails are — `rebuild()` regenerates a space from `media_embeddings`/`faces` after a crash, a model change, or a deleted data dir. Startup verifies row counts per space against SQLite and schedules a rebuild on mismatch.

Why not brute force in SQLite (sqlite-vec): no ANN index, so face assignment (one kNN per new face during a backfill of hundreds of thousands of faces) and semantic text search over millions of images degrade to scans that take days or seconds respectively. Why not a vector server (Qdrant): a second service to install for what an embedded library handles; the interface leaves that door open for a multi-machine deployment.

### 6.4 Analysis input image

Models need a consistent, oriented, decodable JPEG. Rule: **the server renders it, the sidecar never touches originals.**

| Media type | Source | Output |
|---|---|---|
| image | original via Sharp (`.rotate()`; BMP via bmp-js as today) | JPEG, long edge 1600, q85 |
| raw | existing 1800 px preview (already orientation-corrected) | passed through |
| video | existing 500 px poster thumbnail | passed through (embedding only; no faces) |

The 1600 px render is generated per batch and **not persisted** — the decode cost is paid once during backfill and it avoids a third derivative tier on disk. If the fullscreen Viewer later wants a mid-size tier for huge TIFFs, that becomes the persisted tier and this rule switches to reuse it. HEIC decoding depends on the sharp build (prebuilt sharp lacks libheif); HEIC files whose thumbnail already fails today will be `unsupported` here too — a pre-existing gap, out of scope.

### 6.5 Sidecar contract

`memorylane-ai/` — new top-level folder (not an npm workspace): Python 3.11, FastAPI, ONNX Runtime with CoreML/CUDA/CPU execution providers, `open_clip`/`timm` export or a pre-exported ONNX, `insightface`. Packaged as a Dockerfile *and* a `uv run` entry point.

| Endpoint | Request | Response |
|---|---|---|
| `GET /v1/health` | – | `{ device, models: { image_embed: {id, dim}, text_embed: {id, dim}, faces: {id, dim} } }` |
| `POST /v1/embed/image` | multipart, N JPEGs (≤ 32) | `{ model, dim, vectors: float32[][] }` (L2-normalised) |
| `POST /v1/embed/text` | JSON `{ texts[] }` | same shape |
| `POST /v1/faces` | multipart, N JPEGs | per image: `[{ bbox: [x,y,w,h] normalised 0–1, landmarks5, det_score, embedding: float32[512] }]` |
| `POST /v1/cluster` | JSON `{ vectors, min_cluster_size, threshold }` | `{ labels: int[] }` |

Rules: no file paths in the API; no auth beyond loopback by default (`MEMORYLANE_AI_TOKEN` optional bearer for remote hosts); every response carries the model id so the server records the truth, not its assumption.

Model choices (initial, all Apache/MIT-licensed, ONNX-exportable):

- **Image/text embedding:** SigLIP base (or CLIP ViT-B/32 as the small fallback). One model gives similarity *and* free-text search. DINOv2 is better at fine-grained near-duplicate matching but has no text side; consider it as a second embedding only if stack refinement proves weak.
- **Faces:** InsightFace `buffalo_l` (RetinaFace detector + ArcFace 512-d). Industry-standard for identity clustering.
- **Clustering:** HDBSCAN (scikit-learn) on cosine distance.

## 7. Feature: Full EXIF capture and reports

### 7.1 Storage

Two-tier, following the `media_engagement` precedent of keeping behavioural/derived data off `media`:

```sql
CREATE TABLE media_exif (
  media_id            INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  -- promoted, typed, indexed: the fields reports and filters use
  captured_at_precise TEXT,      -- DateTimeOriginal + SubSecTimeOriginal, ISO 8601 with ms
  captured_tz_offset  TEXT,
  camera_make         TEXT, camera_model TEXT, camera_serial TEXT,
  lens_id             TEXT,      -- ExifTool composite LensID, falls back to LensModel
  lens_make TEXT, lens_serial TEXT,
  focal_length REAL, focal_length_35mm REAL,
  aperture REAL, shutter_speed_s REAL, iso INTEGER, exposure_compensation REAL,
  exposure_program TEXT, metering_mode TEXT, flash_fired INTEGER, white_balance TEXT,
  drive_mode TEXT,               -- maker-note, normalised ("single"|"continuous"|...) when known
  burst_id TEXT,                 -- maker-note burst/sequence UUID when the camera writes one (Apple BurstUUID, Sony/Nikon SequenceNumber-derived)
  shutter_count INTEGER,
  rating INTEGER, label TEXT, keywords_json TEXT,   -- XMP, if present
  gps_lat REAL, gps_lon REAL, gps_alt REAL,
  software TEXT,
  -- everything else
  tags_json           TEXT NOT NULL,   -- full ExifTool dump (-G1 groups), binary/preview tags stripped
  exiftool_version    TEXT NOT NULL
);
CREATE INDEX idx_media_exif_lens     ON media_exif(lens_id);
CREATE INDEX idx_media_exif_camera   ON media_exif(camera_model);
CREATE INDEX idx_media_exif_aperture ON media_exif(aperture);
CREATE INDEX idx_media_exif_iso      ON media_exif(iso);
CREATE INDEX idx_media_exif_focal    ON media_exif(focal_length);
CREATE INDEX idx_media_exif_captured ON media_exif(captured_at_precise);
```

- The existing `media.camera_make/model/lens_model/…` columns stay (they feed today's DTOs) and are written from the same extraction; `media_exif` is the superset. A later cleanup can drop them.
- `tags_json` sizing: typically 3–8 KB/file after stripping `ThumbnailImage`/`PreviewImage`/`JpgFromRaw*`/maker-note binary blobs. 500k files ≈ 2–4 GB. Acceptable for a "disposable cache" DB; if it matters, store as SQLite JSONB (3.45+) or zstd later — the column is internal.
- Ad-hoc questions not covered by promoted columns go through `json_extract(tags_json, '$.ExifIFD:FocusMode')` — slow but fine for the report page's "any tag" mode.

### 7.2 Extraction

`processMediaItem` already holds the full `Tags` object, so it writes `media_exif` directly during a scan — no second ExifTool call. The `exif_full` analyzer (in-process) exists only for **backfill** of media indexed before this feature and for re-runs when the promotion mapping changes (`modelVersion = "exif-promote-v1"`). Name normalisation (lens strings) lives in one pure module, `server/src/exif/promote.ts`, and is unit-tested against fixture tag dumps from real cameras.

### 7.3 Reports API

- `GET /api/reports/facets?field=lens_id|camera_model|iso|aperture|focal_length_35mm|year|…&<any MediaQuery filters>` → `[{ value, count }]`. Numeric fields get bucketed server-side (aperture stops, ISO doublings, focal ranges).
- `GET /api/media?lens=…&apertureMax=1.8&isoMin=6400&from=2019-06&to=2019-08&…` — all filters are MediaQuery parameters (§8.1), so a facet click becomes a grid.
- Client: a **Reports** page with facet panels (lens / body / aperture / ISO / focal / year) as clickable bars; selection narrows the other facets and shows the matching grid below. Export CSV of the current selection's promoted columns (cheap; ships with the page).

## 8. Feature: Stacks

### 8.1 MediaQuery builder (prerequisite refactor)

Every listing route today concatenates its own WHERE clause. Stacks add "collapse to cover", persons add "has face of person X", reports add EXIF filters — the combinatorics need one owner.

`server/src/query/media-query.ts` — pure function `buildMediaQuery(params): { where: string; joins: string; bindings: unknown[]; orderBy: string }` composed from small clause builders (scope: folder/subtree/root/all; type; status; companions; stacks; persons; date range; EXIF facets). Zod schema for params in `shared/`. The existing `EXCLUDE_*` fragments move here. Routes call it and add only their own pagination/ordering. Covered by table-driven unit tests over the emitted SQL (run against an in-memory SQLite seeded with a few rows, not string-compared).

### 8.2 Data model

```sql
CREATE TABLE stacks (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL,           -- 'burst' (auto) | 'manual'
  cover_media_id  INTEGER NOT NULL REFERENCES media(id),
  parent_folder_id INTEGER NOT NULL REFERENCES folders(id),
  rule_version    TEXT,                    -- stacker version that created it (NULL for manual)
  user_modified   INTEGER NOT NULL DEFAULT 0,  -- once set, the auto-stacker never rewrites this stack
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE stack_members (
  stack_id  INTEGER NOT NULL REFERENCES stacks(id) ON DELETE CASCADE,
  media_id  INTEGER NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,  -- a photo is in at most one stack
  position  INTEGER NOT NULL,
  PRIMARY KEY (stack_id, media_id)
);
CREATE TABLE stack_exclusions (                -- "never auto-stack this photo again"
  media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE
);
CREATE TABLE media_phash (
  media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  phash    INTEGER NOT NULL,                -- 64-bit DCT perceptual hash from the thumbnail
  version  TEXT NOT NULL
);
```

Listing: `EXCLUDE_STACKED_NON_COVERS = "(id NOT IN (SELECT media_id FROM stack_members) OR id IN (SELECT cover_media_id FROM stacks))"` (parenthesised so it composes with `AND` like the other fragments) — applied when `collapseStacks=true` (default in folder grid; off in stack-expanded view, search, and Surprise Me which should treat a stack as one moment and pick its cover). `MediaDto` gains `stack: { id, count } | null`.

### 8.3 Stacker v1 (in-process, no AI)

`phash` analyzer: DCT hash from the existing 500 px thumbnail (pure TS over Sharp raw pixels; ~1 ms each). Then `StackService.recomputeFolder(folderId)` runs after any scan that touched the folder (and on demand):

1. Load active stills in the folder with `captured_at_precise`, `camera_serial`/`camera_model`, `lens_id`, `focal_length`, `burst_id`, `phash`, sorted by capture time then filename.
2. Sequential grouping: photo *j* joins the current group if **all** of
   - same body (serial, else model),
   - Δt from the previous member ≤ `gapSeconds` (default 2.0; setting),
   - `hamming(phash_j, phash_prev) ≤ maxHamming` (default 14/64; setting) **or** `burst_id` equal and non-null (camera says it's a burst — trust it regardless of visual),
   - neither photo is in `stack_exclusions` or an existing `user_modified` stack.
3. Groups with ≥ 2 members become stacks (`kind='burst'`, cover = first of the series; the user can change it). Existing auto stacks in the folder that are not `user_modified` are replaced wholesale (idempotent recompute).
4. Live-Photo videos and paired RAWs are never members themselves; they follow their still.

Why per-folder and sequential: bursts don't cross folders in real workflows, and a single time-sorted pass is O(n) with no pairwise blow-up. Cross-folder "similar photos" is a different feature (§9), not stacking.

### 8.4 Stacker v2 (embedding refinement)

When `embed_image` vectors exist, step 2's visual test becomes `hamming ≤ maxHamming OR cosine(e_j, e_prev) ≥ minCosine` (default 0.90). This catches bursts where the subject moves enough to break the pHash (bird takes off) while the scene is unmistakably the same. Same rule file, `rule_version` bumps to `burst-v2`, non-user-modified stacks recompute.

### 8.5 User operations (API)

`POST /api/stacks` (manual from a selection), `POST /api/stacks/:id/cover`, `POST /api/stacks/:id/split` (members → new stack or unstacked), `POST /api/stacks/:id/merge`, `DELETE /api/stacks/:id/members/:mediaId` (also adds to `stack_exclusions`), `DELETE /api/stacks/:id`. All set `user_modified=1`. Client: stack badge with count on the cover tile; click expands inline (filmstrip strip below the row, like Lightroom) or a stack page; keyboard left/right inside the Viewer moves within the stack first.

## 9. Feature: Similarity and text search (embedding-backed)

```sql
CREATE TABLE media_embeddings (
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  model    TEXT NOT NULL,
  dim      INTEGER NOT NULL,
  vector   BLOB NOT NULL,               -- float32[dim], L2-normalised
  PRIMARY KEY (media_id, model)
);
```

- Every write to `media_embeddings` is mirrored into the VectorIndex space `media:<model>` (§6.3a). Queries go through `VectorIndex.search`; the SQLite BLOB is never scanned for similarity.
- **Find similar:** `GET /api/media/:id/similar?limit=50` → kNN in the same model, excluding companions/stack siblings.
- **Text search:** `GET /api/search?q=…&mode=semantic` → `embedText` via the provider, kNN, merged with FTS results. Zero per-query model cost beyond a text forward pass.
- **Stack v2** reads vectors from here (§8.4).

## 10. Feature: Persons

### 10.1 Data model

```sql
CREATE TABLE persons (
  id            INTEGER PRIMARY KEY,
  name          TEXT,                       -- NULL until the user names them
  auto_label    TEXT NOT NULL,              -- "Person 12" (stable, never reused)
  cover_face_id INTEGER,                    -- REFERENCES faces(id), set after faces exist
  hidden        INTEGER NOT NULL DEFAULT 0, -- user chose to hide (strangers, crowds)
  merged_into   INTEGER REFERENCES persons(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE faces (
  id            INTEGER PRIMARY KEY,
  media_id      INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  model         TEXT NOT NULL,              -- "buffalo_l@1"
  bbox_x REAL NOT NULL, bbox_y REAL NOT NULL, bbox_w REAL NOT NULL, bbox_h REAL NOT NULL, -- normalised 0–1 of the oriented image
  landmarks_json TEXT,
  det_score     REAL NOT NULL,
  quality       REAL,                       -- size × sharpness proxy; low-quality faces don't seed clusters
  embedding     BLOB NOT NULL,              -- float32[512]
  person_id     INTEGER REFERENCES persons(id),
  assigned_by   TEXT,                       -- 'auto' | 'user'  (user assignments are never overridden)
  assign_score  REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_faces_media  ON faces(media_id);
CREATE INDEX idx_faces_person ON faces(person_id);
CREATE TABLE face_person_rejections (     -- "this face is NOT that person" (negative constraints)
  face_id   INTEGER NOT NULL REFERENCES faces(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  PRIMARY KEY (face_id, person_id)
);
```

Face embeddings are mirrored into the VectorIndex space `faces:<model>` (§6.3a); only faces with a `person_id` are searched during assignment (`filter.idsIn` from a cheap SQL lookup, or a separate `faces-assigned:<model>` space if that list grows too large to pass).

### 10.2 Pipeline

1. **Detect** (`faces` analyzer, sidecar): per image → faces rows. Faces smaller than 3 % of the long edge or `det_score < 0.6` are stored but flagged low-quality (`quality`), so a crowd of 40 blurry heads doesn't spawn 40 "persons".
2. **Assign incrementally** (in-process, `PersonService.assignNewFaces`): for each new quality face, kNN via the VectorIndex restricted to faces with a `person_id`. During an initial backfill this step is skipped (nothing is labelled yet) and step 3 does the bulk work; incremental assignment is the steady-state path for new photos. If the best match's cosine ≥ `assignThreshold` (default 0.62 for ArcFace; setting) and that person isn't in the face's rejections, assign `assigned_by='auto'`. This keeps known people up to date as new photos arrive without re-clustering the world.
3. **Discover** (`PersonService.discover`, scheduled after a batch of new faces or on demand): send all *unassigned* quality face embeddings to `/v1/cluster` (HDBSCAN, `min_cluster_size` default 3). Each cluster becomes a new person `Person N`; members get `assigned_by='auto'`. Noise stays unassigned. Clusters are also compared against existing persons' centroids to avoid creating a duplicate of someone the user already named (merge if centroid cosine ≥ threshold).
4. **User corrections are constraints, not overrides that decay**: `assigned_by='user'` rows are never touched by steps 2–3; rejections are honoured in step 2; merge repoints faces and sets `merged_into`; rename is just `name`. Re-running discovery after a model change (`modelVersion` bump → all `faces` rows for the old model are deleted and re-detected) preserves user labels by re-matching user-assigned faces on bbox overlap in the same media before clustering.

### 10.3 API and UX

- `GET /api/persons` (with face counts, cover crop URL, hidden filter), `PATCH /api/persons/:id` (name/hidden), `POST /api/persons/:id/merge`, `GET /api/persons/:id/faces`, `POST /api/faces/:id/assign` (person or `null`), `POST /api/faces/:id/reject`.
- Face crops: `GET /api/faces/:id/crop` renders from the thumbnail/preview with Sharp (bbox + 30 % padding) and caches on disk under `<data-dir>/faces/` sharded like thumbnails.
- `GET /api/media?personIds=1,2&from=…&to=…&lens=…` via MediaQuery (`personIds` → `EXISTS (SELECT 1 FROM faces WHERE faces.media_id = media.id AND person_id IN (…))`).
- Client: **People** page (grid of persons by count; unnamed first as "Person N"); person page with their photos, a "faces" tab for verifying/rejecting; Viewer overlay toggle showing boxes with names; rename inline.
- Privacy: the persons feature is **opt-in** in Settings (faces are biometric data even when local); "Delete all face data" removes `faces`, `persons`, the `faces:*` VectorIndex spaces, and the crop cache in one action.

## 11. Optional later analyzer: LLM captions/keywords

`caption` analyzer via a `CaptionProvider` (Claude vision on the 1600 px input, or a local VLM through the sidecar) writing `media_captions(media_id, model, caption, keywords_json)` and indexing into FTS. Pure enrichment; nothing above depends on it. Costed per image, so it should support "run on favourites / selected folders only". Not designed further here.

## 12. Configuration and settings

Environment: `MEMORYLANE_AI_URL`, `MEMORYLANE_AI_TOKEN`, `MEMORYLANE_AI_PROVIDER` (`sidecar`|`none`).
Settings (DB, editable in UI): per-analyzer enable, worker concurrency, stack `gapSeconds`/`maxHamming`/`minCosine`, person `assignThreshold`/`minClusterSize`, persons opt-in. All thresholds have defaults chosen from the literature and a "recompute" button so tuning is a loop, not a migration.

## 13. Delivery phases

Each phase is its own spec → plan → implementation cycle and ships user-visible value; later phases never require redoing earlier ones.

| Phase | Delivers | Needs sidecar? |
|---|---|---|
| **1. EXIF** | `media_exif`, promotion module + fixtures, backfill analyzer, `media_analysis` table + `AnalysisWorker` (in-process analyzers only), MediaQuery builder, Reports page with facets + CSV | No |
| **2. Stacks v1** | `phash` analyzer, stack tables, StackService v1, collapse in grids, stack UI + user ops | No |
| **3. Embeddings** | `memorylane-ai` sidecar (embed endpoints), `SidecarProvider`, `media_embeddings`, `VectorIndex` (LanceDB) + rebuild, Find Similar, semantic text search, Stacks v2 | Yes |
| **4. Persons** | sidecar `/faces` + `/cluster`, faces/persons tables, PersonService (assign/discover/constraints), People UI, person filters | Yes |
| 5 (optional) | Captions/keywords via cloud or local VLM | Either |

Phase 1 carries the pipeline scaffolding so it's exercised by cheap analyzers before a model is in the loop.

## 14. Testing strategy

The repo has vitest wired but no tests; this work introduces them where the logic is pure and the cost of being wrong is high:

- `exif/promote.ts` — fixture `Tags` dumps from several bodies (Canon, Nikon, Sony, Fuji, iPhone) → expected promoted rows.
- `query/media-query.ts` — parameter combinations executed against an in-memory SQLite with seeded rows; assert returned ids, not SQL strings.
- `stacks/stacker.ts` — pure grouping function over synthetic rows (timestamps, hashes, burst ids, exclusions, user-modified stacks).
- `persons/person-service.ts` — assignment and constraint logic with synthetic unit vectors; a fake `ClusteringProvider`.
- `AnalysisWorker` — fake analyzers; restart reconciliation; backoff when the provider throws.
- Sidecar — `pytest` contract tests (shapes, normalisation, determinism) with 2–3 fixture images; the Node side has a **fake sidecar** (tiny Fastify server) for integration tests so CI never needs the models.

## 15. Operations, hardware, cost

- Throughput on Apple Silicon (CoreML) for a 24–45 MP library: JPEG decode/resize dominates; embedding ≈ 30–60 img/s, faces ≈ 8–15 img/s. A 500k-image backfill is hours for embeddings and a day-plus for faces — hence the resumable queue, the pause-during-scan rule, and per-analyzer enable toggles.
- CPU-only (Windows/Linux without GPU) is 5–10× slower but works; NVIDIA via CUDA EP is fastest.
- No per-image cloud cost in phases 1–4. Disk (500k-image library): `media_exif` ≈ 2–4 GB, embeddings ≈ 1.5 GB in SQLite plus roughly the same again for the LanceDB index under `vectors/`, faces ≈ 2 KB per face — all inside the disposable data dir.
- Sidecar distribution: Docker image (`docker run -p 4281:4281 memorylane/ai`) and `uv run memorylane-ai`. The tray app stays unchanged and simply shows "AI features: not connected" until a sidecar answers.

## 16. Risks and open decisions

| Item | Notes / proposed resolution |
|---|---|
| LanceDB is a native dependency and a young project | Confine it to the single `VectorIndex` implementation; SQLite stays the durable source so the index can be rebuilt or the library replaced (Qdrant, hnswlib) without touching features. Verify the prebuilt binary loads from the desktop `runtime/` layout in Phase 3. |
| pHash on 500 px thumbnails vs. subtle bursts | Thresholds are settings; Phase 3 adds the embedding path. If v1 under-groups on wildlife bursts, the fix is v2, not re-tuning forever. |
| Face threshold tuning / false merges | Default conservative (fewer auto-merges); the People UI makes corrections cheap and sticky. |
| Model version churn | `modelVersion` on every result; re-run is a queue event, not a migration. Old vectors are dropped with the old model. |
| HEIC decode | Pre-existing sharp limitation; document, don't solve here. |
| DB growth | Everything lives in the rebuildable data dir; size shown in Settings storage stats like thumbnails today. |
| Sequential stacker misses interleaved bursts (two bodies in one folder) | Grouping key includes body serial, so streams from two cameras form independent runs correctly. |
| Files with no EXIF (scans, screenshots) have no `captured_at_precise` | **Decided:** fall back to `fs_created_at`; such files never stack (no body serial). |
| Stack cover selection | **Decided:** first of the series; no sharpness scoring. The user can re-cover. |
