# Media Intelligence Phase 4 (Persons) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect faces, group them into identities auto-labelled "Person 1, Person 2, …", let the user rename/merge/hide/correct them, and browse "photos of X" (optionally in a date range) — opt-in, fully local, with one-click deletion of all face data.

**Architecture:** The sidecar gains `/v1/faces` (YuNet detector + 5-point alignment + SFace 128-d embedding, both **Apache-2.0** ONNX models from OpenCV Zoo, loaded straight into `onnxruntime`) and `/v1/cluster` (Chinese-whispers over a cosine kNN graph, numpy only). A `faces` analyzer on the existing worker renders a 1600 px oriented JPEG per still, sends batches, stores `faces` rows + vectors in a `faces:<model>` index space. `PersonService` assigns each new quality face to the nearest known person (kNN ≥ threshold, honouring rejections), and periodically runs discovery over unassigned faces to create new persons. User assignments are constraints that survive re-clustering and model changes. Everything is behind a `personsEnabled` opt-in.

**Tech Stack:** as Phase 3. Models: `face_detection_yunet_2023mar.onnx` (233 KB, fixed 640×640 input) and `face_recognition_sface_2021dec.onnx` (38 MB, 112×112 → 128-d), fetched from GitHub (opencv_zoo) into `~/.cache/memorylane-ai/` with SHA-256 checks.

**Spec:** design doc §6.4, §6.5, §10, §12, §13 (Phase 4), §16.

**Measured (spike, M2 Max CPU):** detect+align+embed ≈ 98 ms/image at 640 px detection. Same-person cosine 0.64–0.89; different-person 0.11–0.19. Defaults chosen from that: assign threshold 0.45, discovery link threshold 0.5, min cluster size 3 (2 in tests).

**Licensing decision:** InsightFace `buffalo_l` (ArcFace) is stronger but *non-commercial research only*, which conflicts with this repo's MIT distribution. YuNet+SFace are Apache-2.0. The model id `yunet-sface@1` is part of every vector's space name, so a future opt-in `buffalo_l` provider is a swap, not a redesign.

**Branch:** `feature/media-intelligence-phase4-persons` from Phase 3; PR targets Phase 3 until #3 merges.

## Global Constraints

- **Opt-in.** `personsEnabled` default `false`. Nothing face-related runs, and no face endpoint returns data, until the user turns it on in Settings › People. "Delete all face data" removes `faces`, `persons`, rejections, the `faces:*` index spaces and the crop cache in one action.
- User assignments (`assigned_by = 'user'`) and rejections are never overridden by assignment or discovery.
- A face belongs to exactly one media; a person's cover is one of its faces.
- The sidecar never receives paths; the server renders and sends JPEG bytes (design §6.4 — this phase introduces the 1600 px render).
- Vectors from different face models never mix (`faces:<model>` space); a model-id change re-detects everything (analyzer version bump) and preserves user labels by bbox overlap (Task 6).
- Same commit/trailer/shared-rebuild/test rules as earlier phases.

## File Structure

**Sidecar** — `memorylane_ai/face_model.py` (download+verify models, detect, align, embed), `memorylane_ai/cluster.py` (Chinese whispers), `main.py` (+`/v1/faces`, `/v1/cluster`, health `faces` entry), `tests/test_faces.py` + `tests/fixtures/` (4 public-domain portraits).

**Server — create**: `migrations/019_faces_persons.sql`; `media/analysis-input.ts` (1600 px render); `analysis/analyzers/faces.ts`; `persons/face-repo.ts`; `persons/person-service.ts`; `api/persons-routes.ts`, `api/faces-routes.ts`; tests for each + `media-query` `personIds`.
**Server — modify**: `providers/types.ts` + `sidecar-provider.ts` + `index.ts` (faces/cluster, `expectedFaceModel`), `test/helpers/fake-sidecar.ts` (faces/cluster), `analysis-worker.ts` (async `onIdle`), `registry.ts`, `query/media-query.ts`, `db/settings-repo.ts`, `api/settings-routes.ts`, `config/paths.ts` (`facesDir`), `context.ts`, `server.ts`, `app.ts`, `media/thumbnail-generator.ts` (export BMP helper).
**Shared**: `PersonDto`, `FaceDto`, `PersonDetailDto`, request schemas, settings fields (`personsEnabled`, `faceAssignThreshold`, `faceMinClusterSize`), `mediaListQuerySchema.personIds`.
**Client**: `pages/PeoplePage.tsx`, `pages/PersonPage.tsx`, `components/FaceChip.tsx`, `Layout` nav ("People"), `App` routes, `SettingsPage` (People section), `api/client.ts`.
**Docs**: design doc (§10 deltas: model choice, clustering method, thresholds), `CLAUDE.md`, `README.md`, playbook (People row in the checklist).

---

### Task 1: Sidecar — faces + clustering

**Contract**
| Endpoint | Request | Response |
|---|---|---|
| `POST /v1/faces` | multipart `files` (1–16 JPEGs) | `{ model: "yunet-sface@1", dim: 128, images: FaceDet[][] }` where `FaceDet = { bbox: [x, y, w, h] (normalised 0–1 of the sent image), landmarks: [[x,y]×5] normalised, det_score, embedding: float[128] (L2-normalised) }` |
| `POST /v1/cluster` | `{ vectors: float[][], threshold: 0.5, min_cluster_size: 3, iterations?: 20 }` | `{ labels: int[] }` (−1 = noise/too small; labels are dense 0..k−1) |
| `GET /v1/health` | – | adds `models.faces: { id, dim }` |

- [ ] **Step 1: `face_model.py`** — port the spike (`facespike.py`): `_ensure_models()` downloads the two ONNX files from `https://github.com/opencv/opencv_zoo/raw/main/models/...` into `~/.cache/memorylane-ai/` (override `MEMORYLANE_AI_CACHE`), verifying SHA-256 (compute from the downloaded spike files and pin). `FaceModel.detect_and_embed(list[bytes]) -> list[list[FaceDet]]`: letterbox to 640, run YuNet, decode per stride (`score = sqrt(cls·obj)`, `cx=(gx+dx)·s`, `w=exp(dw)·s`, kps likewise), NMS (IoU 0.3), keep `score ≥ 0.6`, cap 50 faces/image sorted by score; for each, Umeyama similarity transform to the ArcFace 112 reference, PIL affine warp, SFace on BGR 0–255, normalise. Coordinates divided by the letterbox scale then by the original width/height. `info = ModelInfo(id="yunet-sface@1", dim=128, …)`.
- [ ] **Step 2: `cluster.py`** — `chinese_whispers(vectors: np.ndarray, threshold: float, min_cluster_size: int, iterations=20, seed=0) -> list[int]`: cosine similarity in blocks of 512 rows; edges where sim ≥ threshold (weight = sim); labels init = index; for `iterations`, visit nodes in a seeded shuffled order and adopt the label with the highest total edge weight among neighbours; finally relabel components with size < `min_cluster_size` to −1 and densify the rest by descending size. Deterministic for a given seed.
- [ ] **Step 3: routes** — `POST /v1/faces` (max 16 files; 422 on undecodable), `POST /v1/cluster` (pydantic: `vectors` 1–200 000 rows, all same length; `threshold` 0–1; `min_cluster_size` ≥ 1), health `faces` entry. The face model loads lazily on first `/v1/faces` call (keeps CLIP-only startups fast) but health reports it from a static id.
- [ ] **Step 4: tests** — `tests/fixtures/{lincoln1,lincoln2,douglass1,douglass2}.jpg` (public domain, ≤ 300 KB each, resized to 800 px) with a `SOURCES.md` crediting Wikimedia Commons. `test_faces.py`: each portrait yields exactly 1 face with `det_score > 0.8`, bbox inside [0,1], embedding norm 1; same-person cosine > 0.55, cross-person < 0.3; `/v1/cluster` on the 4 embeddings with `min_cluster_size=2, threshold=0.5` → two clusters `[0,0,1,1]` (up to label order); a blank image yields `[]`; cluster rejects mismatched dims (422).

Run `pytest -q` → all pass. Commit: `feat(ai): face detection/embedding and clustering endpoints`.

---

### Task 2: Server foundations — migration, provider faces/cluster, fake sidecar, paths, analysis input

- [ ] **Migration 019**
```sql
CREATE TABLE persons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,                       -- NULL until the user names them
  auto_label    TEXT NOT NULL UNIQUE,       -- "Person 12" - stable, never reused
  cover_face_id INTEGER,                    -- REFERENCES faces(id); enforced in code (circular)
  hidden        INTEGER NOT NULL DEFAULT 0,
  merged_into   INTEGER REFERENCES persons(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE faces (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id      INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  model         TEXT NOT NULL,
  bbox_x REAL NOT NULL, bbox_y REAL NOT NULL, bbox_w REAL NOT NULL, bbox_h REAL NOT NULL,  -- normalised to the oriented image
  landmarks_json TEXT,
  det_score     REAL NOT NULL,
  quality       REAL NOT NULL,              -- det_score * min(1, longest bbox edge / 0.05); < 0.5 = never seeds a person
  embedding     BLOB NOT NULL,              -- float32[dim], L2-normalised
  person_id     INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  assigned_by   TEXT,                       -- 'auto' | 'user'
  assign_score  REAL,
  discovered_at TEXT,                       -- last discovery run that considered this face (NULL = never)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_faces_media ON faces(media_id);
CREATE INDEX idx_faces_person ON faces(person_id);
CREATE INDEX idx_faces_unassigned ON faces(person_id, quality, discovered_at);
CREATE TABLE face_person_rejections (
  face_id   INTEGER NOT NULL REFERENCES faces(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  PRIMARY KEY (face_id, person_id)
);
```
- [ ] **Provider** — `types.ts`: `FaceDetection { bbox: [number, number, number, number]; landmarks: [number, number][]; detScore: number; embedding: Float32Array }`; `FaceProvider { expectedFaceModel: string; detectFaces(jpegs: Buffer[]): Promise<{ model; dim; images: FaceDetection[][] }>; cluster(vectors: Float32Array[], opts: { threshold: number; minClusterSize: number }): Promise<number[]> }`; `AiProvider = EmbeddingProvider & FaceProvider`; `ProviderInfo.faceModel: string | null`. `SidecarProvider` implements both (`MEMORYLANE_AI_FACE_MODEL` default `yunet-sface@1`; health also checks `models.faces.id`; `/v1/cluster` JSON with `Array.from` vectors; 60 s timeout for cluster, batches of ≤ 200k). Rename `EmbeddingProvider` usages in `context.ts`/worker to `AiProvider`.
- [ ] **Fake sidecar** — `/v1/faces`: for each file, N faces derived from the bytes (`faces = bytes[0] % 3`, deterministic bboxes, embedding from `vectorForBytes(bytes, dim)` rotated by face index); `/v1/cluster`: connected components at `threshold` then drop small. Health `faces: { id: "yunet-sface@1", dim: 8 }`.
- [ ] **Paths** — `facesDir = <data>/faces` (crop cache; mkdir). **Analysis input** — `media/analysis-input.ts`: `renderAnalysisJpeg(paths, row): Promise<Buffer | null>` — `image`: `sharp(original).rotate()` (BMP via exported `sharpFromBmpFile`) `.resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 })`; `raw`: preview file bytes if present else thumbnail; `video`: null. Errors → null. Unit test with a temp JPEG/BMP.

Run tests → PASS. Commit: `feat(persons): schema, face provider contract, analysis input render`.

---

### Task 3: `faces` analyzer + `FaceRepo` + worker async idle

- [ ] **`persons/face-repo.ts`** — `replaceForMedia(mediaId, model, dets: FaceDetection[], imageLongEdgeNorm)` (transaction: delete old faces for media+model, insert new, returns new face ids + quality), `get(faceId)`, `listForMedia(mediaId)`, `unassignedQuality(model, limit?)` (`person_id IS NULL AND quality ≥ 0.5`), `assignedIds(model)`, `setAssignment(faceId, personId | null, by, score)`, `markDiscovered(faceIds, at)`, `countByPerson()`, `deleteAll()`. Quality: `det_score * min(1, max(bbox_w, bbox_h) / 0.05)`.
- [ ] **`analysis/analyzers/faces.ts`** — key `faces`, version `provider.expectedFaceModel`, batch 8, `appliesTo: "media_type IN ('image','raw') AND thumbnail_status = 'done'"`, `isEnabled: () => settings.personsEnabled && settings.aiEnabled`. Run: health check (face model must match) → render inputs (null → `unsupported`) → `provider.detectFaces` → `faceRepo.replaceForMedia` → `index.remove(space, oldFaceIds)` + `index.upsert(space, newFaces)` → `persons.assignNewFaces(newIds)` (Task 4; injected as a callback to avoid a cycle) → outcomes.
- [ ] **Worker** — `onIdle?: () => number | Promise<number>` (await it). Registry appends `faces` when provider present.
- [ ] Tests: analyzer with fake sidecar writes faces + index rows, replaces on re-run (no duplicates), unsupported for a media without a renderable input; worker awaits async idle hook.

Commit: `feat(persons): faces analyzer`.

---

### Task 4: `PersonService` — assignment, discovery, corrections

```ts
export class PersonService {
  constructor(db, logger, settings: SettingsRepo, provider: () => AiProvider | null, index: VectorIndex)
  // incremental: kNN among assigned faces; assign when best ≥ faceAssignThreshold and not rejected
  async assignNewFaces(faceIds: number[]): Promise<number>
  // discovery over unassigned quality faces with discovered_at IS NULL (plus all other unassigned quality faces as context)
  needsDiscovery(): boolean
  async discover(): Promise<{ persons: number; assigned: number }>
  listPersons(opts: { includeHidden: boolean }): PersonDto[]
  getPerson(id): PersonDto | null
  rename(id, name: string | null): PersonDto
  setHidden(id, hidden: boolean): PersonDto
  merge(intoId, fromId): PersonDto              // repoints faces (assigned_by kept), moves rejections, sets merged_into, hides `from`
  assignFace(faceId, personId | null): FaceDto  // user assignment; null = unassign + reject current
  rejectFace(faceId, personId): FaceDto         // "not this person": unassign if currently that person, add rejection
  listFaces(personId, limit, offset): FaceDto[]
  deleteAllFaceData(): Promise<void>            // faces, persons, rejections, faces:* spaces, crop cache; media_analysis rows for `faces` → pending
}
```
Discovery details: `vectors = unassigned quality faces`; `labels = provider.cluster(vectors, { threshold: 0.5, minClusterSize: faceMinClusterSize })`; for each cluster: centroid → compare against existing persons' centroids (mean of their faces' vectors, cached per run); if best ≥ `faceAssignThreshold` → assign cluster members to that person (skipping rejected ones), else create `Person N` (N = `MAX(id)+1`, auto_label unique) with cover = highest-quality member; noise stays unassigned; all considered faces get `discovered_at = now`. Runs from the worker's idle hook via `discoverIfNeeded()` (cheap `needsDiscovery()` guard, and only when `personsEnabled`).

Tests (fake provider + real Lance in temp dir): assignment picks nearest known person above threshold and respects rejections; discovery creates two persons from two tight groups and leaves a singleton unassigned (min size 2); merge moves faces and hides the source; user assignment survives a later discovery; `deleteAllFaceData` empties everything and resets analysis rows.

Commit: `feat(persons): PersonService with assignment, discovery and corrections`.

---

### Task 5: API + query + settings

- Shared: `PersonDto { id; name; autoLabel; displayName; coverFaceId; faceCount; mediaCount; hidden }`, `FaceDto { id; mediaId; bbox; detScore; quality; personId; assignedBy }`, `PersonDetailDto { person: PersonDto; faces: FaceDto[] }`; schemas: `renamePersonRequestSchema { name: string|null (≤ 80) }`, `hidePersonRequestSchema`, `mergePersonsRequestSchema { personId }`, `assignFaceRequestSchema { personId: number|null }`, `rejectFaceRequestSchema { personId }`; `mediaListQuerySchema.personIds` (comma list → number[]); settings `personsEnabled` (bool, default false), `faceAssignThreshold` (0.3–0.9, default 0.45), `faceMinClusterSize` (2–20, default 3).
- `media-query.ts`: `personIds?: number[]` → `EXISTS (SELECT 1 FROM faces f WHERE f.media_id = media.id AND f.person_id IN (…))`.
- Routes (all 404 with `{ error: "People is turned off" }` unless `personsEnabled`, except the settings toggle itself):
  `GET /api/persons?includeHidden`, `GET /api/persons/:id` (detail + first 60 faces), `PATCH /api/persons/:id` (name/hidden), `POST /api/persons/:id/merge`, `GET /api/persons/:id/faces?offset&limit`, `POST /api/faces/:id/assign`, `POST /api/faces/:id/reject`, `GET /api/faces/:id/crop` (Sharp crop from `renderAnalysisJpeg` output with 30 % padding, 160 px square, cached at `facesDir/<shard>/<id>.jpg`, immutable cache header), `POST /api/persons/discover` (marks discovery needed + kicks the worker), `DELETE /api/persons/data` (delete all).
- `GET /api/media?personIds=1,2&from=&to=` via the existing list route; `GET /api/analysis/status` unchanged (faces analyzer appears automatically).
- Tests: route lifecycle with fake provider (list → rename → merge → assign/reject → media filter by person → delete all → 404 when disabled).

Commit: `feat(persons): people API and person media filter`.

---

### Task 6: Model-change label preservation

When the `faces` analyzer's version changes (new face model), `replaceForMedia` deletes old face rows — including user assignments. Before deleting, carry over: for each old face with `assigned_by = 'user'`, find the new face with max IoU ≥ 0.5 in the same media and copy `person_id`/`assigned_by`/rejections. Unit test with overlapping and non-overlapping boxes. Commit: `feat(persons): preserve user labels across face-model changes`.

---

### Task 7: Client

- `api.persons.*`, `api.faces.*`, `api.media.list` accepts `personIds`.
- **People** nav item (Users icon) → `/people`: person cards (cover crop, display name, "N photos"), unnamed first then by count; "Show hidden" toggle; empty states for off/queue-running; "Find people now" button (discover).
- `/people/:id`: header with cover crop + inline rename (input on click, Enter saves) + Hide/Unhide + Merge into… (select of other persons); date range inputs; photo grid (`api.media.list({ personIds: [id], from, to })`) + Viewer; **Faces** section: chips (`FaceChip` = crop + ✓/✗ buttons: ✗ = "not them" → reject; ✓ only shown for auto assignments to confirm → user assignment).
- Settings › **People**: opt-in checkbox with the biometric note, thresholds, "Find people now", "Delete all face data" (confirm).
- Viewer: small "People: A, B" line in the caption when the current media has assigned faces (uses `api.faces.forMedia(id)` lazily). Skip bbox overlays.

Typecheck/build clean. Commit: `feat(client): People pages, face corrections, people settings`.

---

### Task 8: Verification, docs, PR

1. Sidecar pytest (faces) green; real sidecar up.
2. Fixture library + the 4 portraits (2 people) + burst/scenes → enable People, set min cluster 2 → scan → `faces` done; after idle discovery: 2 persons, each with 2 faces; person pages show the right photos; rename "Person 1" → "Abraham Lincoln"; reject one face → it leaves the person; merge two persons → one; `DELETE data` → empty; toggle off → People 404/hidden; zero console errors.
3. Docs: design §10 deltas (models, clustering, thresholds, opt-in default, licensing note), `CLAUDE.md` People section, README AI paragraph, playbook checklist row 13 "People", platform table row for face models (already says raw ONNX — add the Apache-2.0 note).
4. PR against Phase 3.

## Self-review
§10.1 tables ✔ (T2, `discovered_at` added for the discovery trigger). §10.2 pipeline ✔ (T3 detect, T4 assign/discover with constraints, T6 model change). §10.3 API/UX ✔ (T5, T7; Viewer bbox overlay deliberately reduced to a names line). §6.4 1600 px render ✔ (T2). §6.5 `/v1/faces` + `/v1/cluster` ✔ (T1; HDBSCAN replaced by Chinese whispers to avoid a scikit-learn/scipy dependency and O(N²) memory — recorded in docs). Opt-in + delete-all ✔ (T4/T5/T7). Licensing choice recorded at the top.
