# Media Intelligence Phase 2 (Stacks v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse bursts of near-identical shots into *stacks* — detected automatically per folder from capture time, camera body, and a perceptual hash (no AI models) — and let the user expand, re-cover, split, remove, delete, and create stacks.

**Architecture:** A `phash` analyzer (in-process, DCT hash of the existing 500 px thumbnail) runs on the Phase 1 `AnalysisWorker`. A pure `groupBursts()` function turns a folder's time-sorted candidates into groups; `StackService.recomputeFolder()` persists them, replacing only non-user-modified stacks. Folders are marked *dirty* by the scanner and the phash analyzer and recomputed by the worker's new idle hook, so stacks trail scans without coupling scanner ↔ stacks. `buildMediaQuery` gains `collapseStacks`; the folder grid collapses by default, everything else stays expanded. Stack operations are a small REST surface; the client adds a stack badge on cover tiles, a stack panel (modal) for member operations, a selection mode for manual stacks, and Settings thresholds.

**Tech Stack:** as Phase 1 (Node 20, Fastify, better-sqlite3, Sharp for grayscale/resize, vitest; React + Tailwind).

**Spec:** `docs/architecture/2026-09-14-media-intelligence-design.md` §8.1–8.3, 8.5, 12, 13 (Phase 2 row). §8.4 (embedding refinement) is Phase 3.

**Branch:** `feature/media-intelligence-phase2-stacks`, based on `feature/media-intelligence-phase1-exif` (needs `media_exif`, `media_analysis`, `buildMediaQuery`). PR targets the Phase 1 branch until #1 merges.

## Global Constraints

- Same as Phase 1: never touch originals; additive migration `017`; commit per task with the `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` trailer; rebuild `shared` before typechecking.
- A photo is in at most one stack (`stack_members.media_id UNIQUE`).
- The auto-stacker never rewrites a stack with `user_modified = 1`, and never stacks a photo in `stack_exclusions`.
- Companions (paired RAW, Live Photo video) are never stack members; they follow their visible still.
- Stack cover defaults to the first of the series (decided in design §17).
- pHash is stored as 16 hex chars (`TEXT`), not `INTEGER` — SQLite integers are signed 64-bit and JS numbers lose precision past 2^53; hex round-trips exactly through BigInt.

## File Structure

**Server — create**
- `server/migrations/017_stacks.sql` — `media_phash`, `stacks`, `stack_members`, `stack_exclusions`, `stack_dirty_folders`.
- `server/src/stacks/phash.ts` — pure: `phashFromGray(pixels, size)`, `hammingHex(a, b)`.
- `server/src/stacks/stacker.ts` — pure: `groupBursts(rows, opts)`.
- `server/src/stacks/dirty.ts` — `markFoldersDirty(db, ids)` (shared by scanner, analyzer, service).
- `server/src/stacks/stack-service.ts` — `StackService`: candidates, recompute, user ops, attach.
- `server/src/analysis/analyzers/phash.ts` — the `phash` analyzer.
- `server/src/api/stacks-routes.ts` — stack endpoints.
- `server/src/api/decorate-media.ts` — `decorateMedia(ctx, dtos)` = favorites + stack refs.
- Tests: `server/test/stacks/phash.test.ts`, `server/test/stacks/stacker.test.ts`, `server/test/stacks/stack-service.test.ts`, `server/test/api/stacks-routes.test.ts`; additions to `server/test/query/media-query.test.ts`, `server/test/analysis/analysis-worker.test.ts`.

**Server — modify**
- `server/src/analysis/analysis-worker.ts` (idle hook), `server/src/analysis/registry.ts` (paths, phash), `server/src/scanner/scanner-service.ts` (dirty folders), `server/src/query/media-query.ts` (`collapseStacks`), `server/src/api/mappers.ts` (`stack: null`), `server/src/api/folders-routes.ts`, `favorites-routes.ts`, `search-routes.ts`, `media-routes.ts`, `memories-routes.ts`, `home-routes.ts` (decorate + collapse), `server/src/db/settings-repo.ts`, `server/src/api/settings-routes.ts`, `server/src/context.ts`, `server/src/server.ts`, `server/src/app.ts`, `server/src/media/random-selection-service.ts` (collapse).
- `server/test/helpers/app.ts` (stack service in ctx).

**Shared — modify**: `shared/src/types.ts` (`StackRefDto`, `StackDto`, `StackDetailDto`, request types, settings fields), `shared/src/validation.ts` (schemas, `expandStacks` query param).

**Client — create/modify**: `client/src/components/StackPanel.tsx` (new); `client/src/components/MediaGrid.tsx` (badge, selection), `client/src/pages/FolderPage.tsx` (open stack, selection mode), `client/src/pages/SettingsPage.tsx` (Stacks section), `client/src/api/client.ts`.

**Docs**: `CLAUDE.md` (stacks section).

---

### Task 1: Migration 017 — stack tables

**Files:** Create `server/migrations/017_stacks.sql`; modify `server/test/db/migrations.test.ts`.

- [ ] **Step 1: Extend the migrations test** — add to the `names` assertions:
```ts
    for (const t of ["media_phash", "stacks", "stack_members", "stack_exclusions", "stack_dirty_folders"]) expect(names).toContain(t);
```
Run `npm test --workspace=server -- test/db` → FAIL.

- [ ] **Step 2: Write the migration**
```sql
-- Stacks v1 (design doc §8.2): bursts of near-identical shots collapsed
-- into one grid item. Auto stacks are recomputed per folder whenever its
-- contents or hashes change; a stack the user has touched (user_modified)
-- is never rewritten by the stacker.

-- 64-bit DCT perceptual hash of the 500px thumbnail, as 16 hex chars.
CREATE TABLE media_phash (
  media_id   INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  phash      TEXT NOT NULL,
  version    TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE stacks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT    NOT NULL,            -- 'burst' (auto) | 'manual'
  cover_media_id   INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  parent_folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  rule_version     TEXT,                        -- stacker version that created it (NULL for manual)
  user_modified    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_stacks_folder ON stacks(parent_folder_id);

-- A photo is in at most one stack.
CREATE TABLE stack_members (
  stack_id INTEGER NOT NULL REFERENCES stacks(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (stack_id, media_id)
);

-- "Never auto-stack this photo again" - set when the user removes a photo
-- from a stack or deletes a stack outright.
CREATE TABLE stack_exclusions (
  media_id   INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Folders whose contents/hashes changed since their stacks were last
-- computed. Persisted (not in-memory) so a restart mid-scan loses nothing.
CREATE TABLE stack_dirty_folders (
  folder_id INTEGER PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE
);
```
Run the test → PASS. Commit: `feat(db): stack tables and media_phash`.

---

### Task 2: Perceptual hash (pure)

**Files:** Create `server/src/stacks/phash.ts`, `server/test/stacks/phash.test.ts`.

**Interfaces:** `PHASH_VERSION = "phash-dct-v1"`; `PHASH_SIZE = 32`; `phashFromGray(pixels: Uint8Array | number[], size?: number): string` (16 lowercase hex chars); `hammingHex(a: string, b: string): number`.

- [ ] **Step 1: Tests**
```ts
import { describe, it, expect } from "vitest";
import { phashFromGray, hammingHex, PHASH_SIZE } from "../../src/stacks/phash.js";

function gradient(seed = 0, noise = 0): Uint8Array {
  const px = new Uint8Array(PHASH_SIZE * PHASH_SIZE);
  let s = seed;
  for (let y = 0; y < PHASH_SIZE; y++)
    for (let x = 0; x < PHASH_SIZE; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const n = noise ? ((s % (2 * noise + 1)) - noise) : 0;
      px[y * PHASH_SIZE + x] = Math.max(0, Math.min(255, Math.round((x * 255) / 31 + (y % 4) * 10 + n)));
    }
  return px;
}

describe("phash", () => {
  it("is 16 hex chars and deterministic", () => {
    const h = phashFromGray(gradient());
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(phashFromGray(gradient())).toBe(h);
  });
  it("is stable under small noise and far for a different image", () => {
    const a = phashFromGray(gradient());
    const b = phashFromGray(gradient(7, 6));
    expect(hammingHex(a, b)).toBeLessThanOrEqual(8);
    const inverted = gradient().map((v) => 255 - v);
    expect(hammingHex(a, phashFromGray(inverted))).toBeGreaterThanOrEqual(40);
  });
  it("hammingHex counts differing bits", () => {
    expect(hammingHex("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingHex("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingHex("0000000000000001", "0000000000000003")).toBe(1);
  });
  it("rejects a wrong pixel count", () => {
    expect(() => phashFromGray(new Uint8Array(10))).toThrow();
  });
});
```

- [ ] **Step 2: Implementation**
```ts
// server/src/stacks/phash.ts
// Classic DCT perceptual hash (pHash): 32x32 grayscale -> 2D DCT -> keep the
// 8x8 lowest frequencies -> 1 bit per coefficient vs. their median (DC term
// excluded from the median and forced to 0). Robust to resize, mild noise,
// JPEG re-encoding and small exposure shifts; sensitive to composition
// changes - exactly the "same moment, tiny variation" signal bursts need.
export const PHASH_VERSION = "phash-dct-v1";
export const PHASH_SIZE = 32;
const LOW = 8;

const COS: number[][] = [];
for (let u = 0; u < LOW; u++) {
  COS[u] = [];
  for (let x = 0; x < PHASH_SIZE; x++) COS[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PHASH_SIZE));
}

export function phashFromGray(pixels: Uint8Array | number[], size: number = PHASH_SIZE): string {
  if (size !== PHASH_SIZE) throw new Error(`phash expects ${PHASH_SIZE}x${PHASH_SIZE} input`);
  if (pixels.length !== size * size) throw new Error(`phash expects ${size * size} pixels, got ${pixels.length}`);
  // Separable DCT: rows first (only the LOW lowest u), then columns.
  const rows: number[][] = [];
  for (let y = 0; y < size; y++) {
    rows[y] = [];
    for (let u = 0; u < LOW; u++) {
      let s = 0;
      for (let x = 0; x < size; x++) s += pixels[y * size + x] * COS[u][x];
      rows[y][u] = s;
    }
  }
  const coeffs: number[] = [];
  for (let v = 0; v < LOW; v++) {
    for (let u = 0; u < LOW; u++) {
      let s = 0;
      for (let y = 0; y < size; y++) s += rows[y][u] * COS[v][y];
      coeffs.push(s);
    }
  }
  const ac = coeffs.slice(1).sort((a, b) => a - b);
  const median = (ac[31] + ac[32]) / 2;
  let bits = 0n;
  for (let i = 1; i < 64; i++) {
    if (coeffs[i] > median) bits |= 1n << BigInt(63 - i);
  }
  return bits.toString(16).padStart(16, "0");
}

export function hammingHex(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
```
Run tests → PASS. Commit: `feat(stacks): DCT perceptual hash`.

---

### Task 3: Burst grouping (pure)

**Files:** Create `server/src/stacks/stacker.ts`, `server/test/stacks/stacker.test.ts`.

**Interfaces:**
```ts
export const STACK_RULE_VERSION = "burst-v1";
export interface StackCandidate { id: number; filename: string; capturedAt: string | null; body: string | null; phash: string | null; burstId: string | null }
export interface StackerOptions { gapSeconds: number; maxHamming: number }
export const DEFAULT_STACKER_OPTIONS: StackerOptions = { gapSeconds: 2, maxHamming: 14 };
export function groupBursts(rows: StackCandidate[], opts?: StackerOptions): number[][]   // arrays of media ids in capture order, each length >= 2
```

- [ ] **Step 1: Tests**
```ts
import { describe, it, expect } from "vitest";
import { groupBursts, type StackCandidate } from "../../src/stacks/stacker.js";

const H0 = "0000000000000000";
const H1 = "0000000000000001";      // 1 bit from H0
const HFAR = "ffffffffffffffff";
let n = 0;
const c = (o: Partial<StackCandidate>): StackCandidate => ({
  id: ++n, filename: `IMG_${String(n).padStart(4, "0")}.jpg`, capturedAt: "2024-05-12T10:31:44.000", body: "R5-1", phash: H0, burstId: null, ...o,
});
const t = (ms: number) => new Date(Date.UTC(2024, 4, 12, 10, 31, 44, 0) + ms).toISOString().slice(0, 23);

describe("groupBursts", () => {
  it("groups a tight sequence with matching hashes; leaves singles alone", () => {
    n = 0;
    const rows = [c({ capturedAt: t(0) }), c({ capturedAt: t(100), phash: H1 }), c({ capturedAt: t(200) }), c({ capturedAt: t(10_000) })];
    expect(groupBursts(rows)).toEqual([[1, 2, 3]]);
  });
  it("splits on time gap, body change, and visual distance", () => {
    n = 0;
    const rows = [
      c({ capturedAt: t(0) }), c({ capturedAt: t(500) }),           // pair 1
      c({ capturedAt: t(3500) }), c({ capturedAt: t(3600) }),       // gap > 2s -> pair 2
      c({ capturedAt: t(3700), body: "5D" }),                        // other body -> alone
      c({ capturedAt: t(3800), phash: HFAR }),                       // far hash -> alone
    ];
    expect(groupBursts(rows)).toEqual([[1, 2], [3, 4]]);
  });
  it("trusts a shared camera burst id even when hashes differ", () => {
    n = 0;
    const rows = [c({ capturedAt: t(0), burstId: "B1", phash: H0 }), c({ capturedAt: t(100), burstId: "B1", phash: HFAR })];
    expect(groupBursts(rows)).toEqual([[1, 2]]);
  });
  it("skips rows without a capture time or body, and sorts by time then filename", () => {
    n = 0;
    const rows = [
      c({ capturedAt: t(100), filename: "b.jpg" }), c({ capturedAt: t(0), filename: "a.jpg" }),
      c({ capturedAt: null }), c({ capturedAt: t(200), body: null }),
    ];
    expect(groupBursts(rows)).toEqual([[2, 1]]);
  });
  it("requires hashes on both sides unless a burst id matches", () => {
    n = 0;
    expect(groupBursts([c({ capturedAt: t(0), phash: null }), c({ capturedAt: t(50) })])).toEqual([]);
  });
  it("honours custom thresholds", () => {
    n = 0;
    const rows = [c({ capturedAt: t(0) }), c({ capturedAt: t(2500) })];
    expect(groupBursts(rows, { gapSeconds: 2, maxHamming: 14 })).toEqual([]);
    expect(groupBursts(rows, { gapSeconds: 3, maxHamming: 14 })).toEqual([[1, 2]]);
  });
});
```

- [ ] **Step 2: Implementation**
```ts
// server/src/stacks/stacker.ts
import { hammingHex } from "./phash.js";

// Bump when the grouping rule changes so existing auto stacks are recomputed.
export const STACK_RULE_VERSION = "burst-v1";

export interface StackCandidate {
  id: number;
  filename: string;
  capturedAt: string | null;   // media_exif.captured_at_precise (wall clock, ms)
  body: string | null;         // camera serial, else model
  phash: string | null;
  burstId: string | null;      // maker-note burst UUID when present
}

export interface StackerOptions {
  gapSeconds: number;
  maxHamming: number;
}

export const DEFAULT_STACKER_OPTIONS: StackerOptions = { gapSeconds: 2, maxHamming: 14 };

function parseMs(s: string): number {
  // Wall-clock strings carry no offset; treating them as UTC keeps
  // differences correct within one camera's stream, which is all we need.
  return Date.parse(`${s}Z`);
}

// Single time-sorted pass per folder (design doc §8.3): O(n), no pairwise
// blow-up. Photo j joins the open group when it shares a body with the
// previous member, follows it within gapSeconds, and is visually close
// (hash distance) OR carries the same camera burst id.
export function groupBursts(rows: StackCandidate[], opts: StackerOptions = DEFAULT_STACKER_OPTIONS): number[][] {
  const eligible = rows
    .filter((r) => r.capturedAt && r.body)
    .map((r) => ({ ...r, ms: parseMs(r.capturedAt as string) }))
    .filter((r) => Number.isFinite(r.ms))
    .sort((a, b) => a.ms - b.ms || a.filename.localeCompare(b.filename));

  const groups: number[][] = [];
  let current: typeof eligible = [];
  const flush = () => {
    if (current.length >= 2) groups.push(current.map((r) => r.id));
    current = [];
  };

  for (const r of eligible) {
    const prev = current[current.length - 1];
    if (prev) {
      const sameBody = prev.body === r.body;
      const closeInTime = r.ms - prev.ms <= opts.gapSeconds * 1000;
      const sameBurst = !!r.burstId && r.burstId === prev.burstId;
      const similar = !!r.phash && !!prev.phash && hammingHex(r.phash, prev.phash) <= opts.maxHamming;
      if (sameBody && closeInTime && (sameBurst || similar)) {
        current.push(r);
        continue;
      }
      flush();
    }
    current.push(r);
  }
  flush();
  return groups;
}
```
Run tests → PASS. Commit: `feat(stacks): burst grouping rule v1`.

---

### Task 4: Shared types, settings, query-builder collapse

**Files:** Modify `shared/src/types.ts`, `shared/src/validation.ts`, `server/src/db/settings-repo.ts`, `server/src/query/media-query.ts`, `server/src/api/mappers.ts`; tests in `server/test/query/media-query.test.ts`.

- [ ] **Step 1: Shared types** — append to `types.ts`:
```ts
// Stacks (design doc §8): a burst collapsed to one grid item.
export type StackKind = "burst" | "manual";

// Attached to every MediaDto that belongs to a stack.
export interface StackRefDto {
  id: number;
  count: number;
  isCover: boolean;
}

export interface StackDto {
  id: number;
  kind: StackKind;
  coverMediaId: number;
  parentFolderId: number;
  userModified: boolean;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface StackDetailDto {
  stack: StackDto;
  items: MediaDto[]; // members in stack order, cover first is NOT guaranteed - use stack.coverMediaId
}

export interface CreateStackRequest { mediaIds: number[] }
export interface SetStackCoverRequest { mediaId: number }
export interface SplitStackRequest { mediaIds: number[] }
export interface MergeStacksRequest { stackId: number }
export interface RecomputeStacksRequest { folderId?: number }
```
Add to `MediaDto` (after `favorite`): `stack: StackRefDto | null;`. Add to `SettingsDto` and `UpdateSettingsRequest`: `stackGapSeconds: number; stackMaxHamming: number;` (optional in the request).

`validation.ts` — extend `updateSettingsRequestSchema` with `stackGapSeconds: z.number().min(0.1).max(60).optional(), stackMaxHamming: z.number().int().min(0).max(64).optional()`; extend `folderMediaQuerySchema` with `expandStacks: booleanQueryParam`; append:
```ts
const mediaIdList = z.array(z.number().int().positive()).max(500);
export const createStackRequestSchema = z.object({ mediaIds: mediaIdList.min(2) });
export const setStackCoverRequestSchema = z.object({ mediaId: z.number().int().positive() });
export const splitStackRequestSchema = z.object({ mediaIds: mediaIdList.min(2) });
export const mergeStacksRequestSchema = z.object({ stackId: z.number().int().positive() });
export const recomputeStacksRequestSchema = z.object({ folderId: z.number().int().positive().optional() });
```
Rebuild shared.

- [ ] **Step 2: Settings repo** — DEFAULTS `stackGapSeconds: 2, stackMaxHamming: 14`; `getAll` reads `Number(map.get(...))` with fallback; `update` pushes both keys when defined.

- [ ] **Step 3: Mapper** — `toMediaDto` sets `stack: null` (populated by `decorateMedia`, Task 6).

- [ ] **Step 4: Builder** — add `collapseStacks?: boolean` to `MediaQueryParams`; in `buildMediaQuery` after the type clause:
```ts
  if (p.collapseStacks) where.push(COLLAPSE_STACKS);
```
with `export const COLLAPSE_STACKS = "(media.id NOT IN (SELECT media_id FROM stack_members) OR media.id IN (SELECT cover_media_id FROM stacks))";`.
Test (append to media-query.test.ts):
```ts
  it("collapseStacks hides non-cover members", async () => {
    const L = await library();
    const s = L.db.prepare("INSERT INTO stacks (kind, cover_media_id, parent_folder_id) VALUES ('burst', ?, ?)").run(L.jpg, L.top).lastInsertRowid;
    L.db.prepare("INSERT INTO stack_members (stack_id, media_id, position) VALUES (?, ?, 0), (?, ?, 1)").run(s, L.jpg, s, L.video);
    expect(run(L.db, { collapseStacks: true, scope: { kind: "folder", folderId: L.top, recursive: false } })).toEqual([L.jpg]);
    expect(run(L.db, { scope: { kind: "folder", folderId: L.top, recursive: false } })).toEqual([L.jpg, L.video]);
  });
```
Run `npm test --workspace=server && npm run typecheck` → PASS. Commit: `feat(stacks): shared DTOs, settings, collapseStacks in query builder`.

---

### Task 5: `StackService` (candidates, recompute, user ops, attach)

**Files:** Create `server/src/stacks/dirty.ts`, `server/src/stacks/stack-service.ts`, `server/test/stacks/stack-service.test.ts`.

**Interfaces:**
```ts
// dirty.ts
export function markFoldersDirty(db, folderIds: Iterable<number>): void;
// stack-service.ts
export class StackError extends Error { constructor(public status: number, message: string) }
export class StackService {
  constructor(db: Database.Database, logger: Logger, settings: SettingsRepo)
  recomputeFolder(folderId: number): number            // stacks created
  recomputeDirty(limit = 5): number                     // folders processed
  markAllDirty(): number
  getStack(id): StackDto | null
  getMembers(id): MediaRow[]                             // stack order
  attachStacks<T extends { id: number; stack: StackRefDto | null }>(items: T[]): T[]
  createManual(mediaIds: number[]): StackDto
  setCover(stackId, mediaId): StackDto
  split(stackId, mediaIds): StackDto                      // new stack from those members
  merge(intoId, fromId): StackDto
  removeMember(stackId, mediaId): StackDto | null         // null if the stack dissolved
  deleteStack(stackId): void                              // members -> exclusions
}
```

- [ ] **Step 1: Tests** (`server/test/stacks/stack-service.test.ts`)
```ts
import { describe, it, expect } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb, seedScanRoot, seedFolder, seedMedia } from "../helpers/db.js";
import { StackService, StackError } from "../../src/stacks/stack-service.js";
import { SettingsRepo } from "../../src/db/settings-repo.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as import("pino").Logger;
const H0 = "0000000000000000", H1 = "0000000000000001", HFAR = "ffffffffffffffff";
const t = (ms: number) => new Date(Date.UTC(2024, 4, 12, 10, 31, 44, 0) + ms).toISOString().slice(0, 23);

async function setup() {
  const db = await createTestDb();
  const root = seedScanRoot(db);
  const folder = seedFolder(db, root, "/library/burst");
  const svc = new StackService(db, logger, new SettingsRepo(db));
  const exif = db.prepare("INSERT INTO media_exif (media_id, captured_at_precise, camera_serial, burst_id, tags_json, exiftool_version) VALUES (?, ?, ?, ?, '{}', 't')");
  const hash = db.prepare("INSERT INTO media_phash (media_id, phash, version) VALUES (?, ?, 'v')");
  const shot = (ms: number, phash: string | null = H0, body = "R5", burst: string | null = null) => {
    const id = seedMedia(db, folder, root);
    exif.run(id, t(ms), body, burst);
    if (phash) hash.run(id, phash);
    return id;
  };
  return { db, root, folder, svc, shot };
}
const stackOf = (db: Database.Database, mediaId: number) =>
  (db.prepare("SELECT stack_id FROM stack_members WHERE media_id = ?").get(mediaId) as { stack_id: number } | undefined)?.stack_id ?? null;

describe("StackService.recomputeFolder", () => {
  it("creates burst stacks with the first shot as cover and leaves singles", async () => {
    const { db, folder, svc, shot } = await setup();
    const a = shot(0), b = shot(100, H1), c = shot(200), d = shot(10_000);
    expect(svc.recomputeFolder(folder)).toBe(1);
    const s = svc.getStack(stackOf(db, a)!)!;
    expect(s).toMatchObject({ kind: "burst", coverMediaId: a, count: 3, userModified: false });
    expect(stackOf(db, d)).toBeNull();
    expect(svc.getMembers(s.id).map((m) => m.id)).toEqual([a, b, c]);
  });
  it("is idempotent and replaces stale auto stacks", async () => {
    const { db, folder, svc, shot } = await setup();
    const a = shot(0), b = shot(100);
    svc.recomputeFolder(folder);
    const first = stackOf(db, a);
    db.prepare("DELETE FROM media_phash WHERE media_id = ?").run(b);
    db.prepare("INSERT INTO media_phash (media_id, phash, version) VALUES (?, ?, 'v')").run(b, HFAR);
    expect(svc.recomputeFolder(folder)).toBe(0);
    expect(stackOf(db, a)).toBeNull();
    expect(first).not.toBeNull();
  });
  it("never rewrites a user-modified stack and skips excluded photos", async () => {
    const { db, folder, svc, shot } = await setup();
    const a = shot(0), b = shot(100), c = shot(200), d = shot(300);
    svc.recomputeFolder(folder);
    const s = stackOf(db, a)!;
    svc.setCover(s, b); // marks user_modified
    svc.removeMember(s, d); // d excluded, stack now a,b,c
    svc.recomputeFolder(folder);
    expect(svc.getStack(s)).toMatchObject({ coverMediaId: b, count: 3, userModified: true });
    expect(stackOf(db, d)).toBeNull();
  });
  it("recomputeDirty processes marked folders and clears them", async () => {
    const { db, folder, svc, shot } = await setup();
    shot(0); shot(100);
    db.prepare("INSERT INTO stack_dirty_folders (folder_id) VALUES (?)").run(folder);
    expect(svc.recomputeDirty()).toBe(1);
    expect(svc.recomputeDirty()).toBe(0);
    expect((db.prepare("SELECT COUNT(*) c FROM stacks").get() as { c: number }).c).toBe(1);
  });
});

describe("StackService user operations", () => {
  it("createManual, setCover, split, merge, removeMember, deleteStack", async () => {
    const { db, svc, shot } = await setup();
    const a = shot(0, null), b = shot(60_000, null), c = shot(120_000, null), d = shot(180_000, null);
    const s = svc.createManual([a, b, c, d]);
    expect(s).toMatchObject({ kind: "manual", coverMediaId: a, count: 4, userModified: true });
    expect(() => svc.createManual([a, b])).toThrow(StackError);          // already stacked
    expect(svc.setCover(s.id, c).coverMediaId).toBe(c);
    expect(() => svc.setCover(s.id, 9999)).toThrow(StackError);
    const s2 = svc.split(s.id, [c, d]);
    expect(s2.count).toBe(2);
    expect(svc.getStack(s.id)).toMatchObject({ count: 2, coverMediaId: a }); // cover moved out -> falls back to first remaining
    const merged = svc.merge(s.id, s2.id);
    expect(merged).toMatchObject({ id: s.id, count: 4 });
    expect(svc.getStack(s2.id)).toBeNull();
    expect(svc.removeMember(s.id, d)!.count).toBe(3);
    expect((db.prepare("SELECT COUNT(*) c FROM stack_exclusions WHERE media_id = ?").get(d) as { c: number }).c).toBe(1);
    svc.deleteStack(s.id);
    expect(svc.getStack(s.id)).toBeNull();
    expect((db.prepare("SELECT COUNT(*) c FROM stack_exclusions").get() as { c: number }).c).toBe(4);
  });
  it("dissolves a stack that drops below two members", async () => {
    const { svc, shot } = await setup();
    const a = shot(0, null), b = shot(1000, null);
    const s = svc.createManual([a, b]);
    expect(svc.removeMember(s.id, a)).toBeNull();
    expect(svc.getStack(s.id)).toBeNull();
  });
  it("rejects cross-folder manual stacks", async () => {
    const { db, root, svc, shot } = await setup();
    const other = seedFolder(db, root, "/library/other");
    const a = shot(0, null);
    const b = seedMedia(db, other, root);
    expect(() => svc.createManual([a, b])).toThrow(/same folder/);
  });
  it("attachStacks decorates DTO-like items", async () => {
    const { svc, shot } = await setup();
    const a = shot(0, null), b = shot(1000, null), c = shot(5000, null);
    const s = svc.createManual([a, b]);
    const items = [{ id: a, stack: null }, { id: b, stack: null }, { id: c, stack: null }] as { id: number; stack: import("@memorylane/shared").StackRefDto | null }[];
    svc.attachStacks(items);
    expect(items[0].stack).toEqual({ id: s.id, count: 2, isCover: true });
    expect(items[1].stack).toEqual({ id: s.id, count: 2, isCover: false });
    expect(items[2].stack).toBeNull();
  });
});
```

- [ ] **Step 2: Implementation** — `dirty.ts`:
```ts
import type Database from "better-sqlite3";
export function markFoldersDirty(db: Database.Database, folderIds: Iterable<number>): void {
  const stmt = db.prepare("INSERT OR IGNORE INTO stack_dirty_folders (folder_id) VALUES (?)");
  for (const id of new Set(folderIds)) stmt.run(id);
}
```
`stack-service.ts` — full implementation follows the interface above. Key SQL:
- candidates: `SELECT media.id, media.filename, mx.captured_at_precise AS capturedAt, COALESCE(mx.camera_serial, mx.camera_model) AS body, ph.phash, mx.burst_id AS burstId FROM media LEFT JOIN media_exif mx ON mx.media_id = media.id LEFT JOIN media_phash ph ON ph.media_id = media.id WHERE media.parent_folder_id = ? AND media.status = 'active' AND media.media_type IN ('image','raw') AND ${EXCLUDE_LIVE_PHOTO_VIDEOS} AND ${EXCLUDE_PAIRED_RAW} AND media.id NOT IN (SELECT media_id FROM stack_exclusions) AND media.id NOT IN (SELECT sm.media_id FROM stack_members sm JOIN stacks s ON s.id = sm.stack_id WHERE s.user_modified = 1)`
- recomputeFolder: transaction → `DELETE FROM stacks WHERE parent_folder_id = ? AND user_modified = 0`; `groupBursts(candidates, { gapSeconds, maxHamming } from settings)`; insert each group (`kind='burst'`, cover = first, `rule_version = STACK_RULE_VERSION`), members with positions.
- recomputeDirty(limit): `SELECT folder_id FROM stack_dirty_folders LIMIT ?` → for each: delete from dirty **before** recompute (so a concurrent mark during recompute re-dirties), then recomputeFolder in try/catch (log, continue).
- attachStacks: `SELECT sm.media_id, s.id, s.cover_media_id, (SELECT COUNT(*) FROM stack_members m2 WHERE m2.stack_id = s.id) AS count FROM stack_members sm JOIN stacks s ON s.id = sm.stack_id WHERE sm.media_id IN (...)`.
- user ops all in transactions; each sets `user_modified = 1, updated_at = now` on affected stacks; validation errors throw `StackError(400|404, …)`. `removeMember`/`deleteStack` insert into `stack_exclusions`; `split` does not. When a cover leaves a stack (split/remove), cover becomes the lowest-position remaining member. When a stack falls below 2 members it is deleted (the remaining member is *not* excluded).
- `createManual`: all ids must exist, be active, share `parent_folder_id`, and not be in any stack (400 otherwise); cover = first id given; positions in the order given; removes each id from `stack_exclusions` (user explicitly wants them stacked).
- `merge(intoId, fromId)`: both must exist and share a folder; members of `from` appended after `into`'s max position; `from` deleted.

Run tests → PASS. Commit: `feat(stacks): StackService with recompute and user operations`.

---

### Task 6: phash analyzer, worker idle hook, scanner dirty marks, decorate + collapse in routes

**Files:** Create `server/src/analysis/analyzers/phash.ts`, `server/src/api/decorate-media.ts`; modify `analysis-worker.ts`, `registry.ts`, `scanner-service.ts`, `context.ts`, `server.ts`, routes listed in File Structure, `random-selection-service.ts`, `server/test/helpers/app.ts`; tests appended to `analysis-worker.test.ts`.

- [ ] **Step 1: Worker idle hook** — add `onIdle?: () => number` to the constructor `opts`; in `loop()` replace `if (processed === 0) await this.sleep(this.idleMs);` with:
```ts
      if (processed === 0) {
        let idleWork = 0;
        try {
          idleWork = this.onIdle?.() ?? 0;
        } catch (err) {
          this.logger.error({ err }, "Idle task failed");
        }
        if (idleWork === 0) await this.sleep(this.idleMs);
      }
```
Test (append):
```ts
  it("runs the idle hook only when no analyzer work remains", async () => {
    const { db } = await setup(1);
    const a = fakeAnalyzer();
    const calls: number[] = [];
    let remaining = 2;
    const w = new AnalysisWorker(db, logger, [a], () => false, { idleMs: 5, onIdle: () => { calls.push(a.seen.length); return remaining-- > 0 ? 1 : 0; } });
    w.start();
    await wait(80);
    await w.stop();
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((seenBatches) => seenBatches === 1)).toBe(true); // analyzer drained first
  });
```

- [ ] **Step 2: phash analyzer**
```ts
// server/src/analysis/analyzers/phash.ts
import fs from "node:fs";
import type Database from "better-sqlite3";
import sharp from "sharp";
import pLimit from "p-limit";
import { thumbnailPathForMediaId, type AppPaths } from "../../config/paths.js";
import { phashFromGray, PHASH_SIZE, PHASH_VERSION } from "../../stacks/phash.js";
import { markFoldersDirty } from "../../stacks/dirty.js";
import type { Analyzer, AnalysisMediaRow, AnalyzerOutcome } from "../types.js";

export const PHASH_KEY = "phash";

// Hashes the existing 500px grid thumbnail (already oriented and decoded),
// so RAW/HEIC/BMP need no special handling here - if a thumbnail exists, it
// can be hashed. Videos are excluded: a poster frame isn't a burst.
export function createPhashAnalyzer(db: Database.Database, paths: AppPaths): Analyzer {
  const upsert = db.prepare(
    `INSERT INTO media_phash (media_id, phash, version, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(media_id) DO UPDATE SET phash = excluded.phash, version = excluded.version, updated_at = excluded.updated_at`,
  );
  const limit = pLimit(4);
  return {
    key: PHASH_KEY,
    version: PHASH_VERSION,
    batchSize: 50,
    appliesTo: "media_type IN ('image', 'raw') AND thumbnail_status = 'done'",
    async run(rows: AnalysisMediaRow[]): Promise<AnalyzerOutcome[]> {
      const outcomes = await Promise.all(
        rows.map((row) =>
          limit(async (): Promise<AnalyzerOutcome> => {
            const thumb = thumbnailPathForMediaId(paths.thumbnailsDir, row.id);
            if (!fs.existsSync(thumb)) return { mediaId: row.id, status: "unsupported", error: "No thumbnail on disk" };
            try {
              const gray = await sharp(thumb).grayscale().resize(PHASH_SIZE, PHASH_SIZE, { fit: "fill" }).raw().toBuffer();
              upsert.run(row.id, phashFromGray(gray), PHASH_VERSION);
              return { mediaId: row.id, status: "done" };
            } catch (err) {
              return { mediaId: row.id, status: "failed", error: err instanceof Error ? err.message : String(err) };
            }
          }),
        ),
      );
      markFoldersDirty(db, rows.filter((_, i) => outcomes[i].status === "done").map((r) => r.parent_folder_id));
      return outcomes;
    },
  };
}
```
Registry: `createAnalyzers(db, logger, paths)` returns `[createExifFullAnalyzer(db), createPhashAnalyzer(db, paths)]`; update the call in `server.ts`.

- [ ] **Step 3: Scanner dirty marks** — in `indexFile`, after the new-file INSERT and after the changed-file UPDATE: `markFoldersDirty(this.db, [parentFolderId]);`. In `runScan`, change the missing-media statement to `RETURNING id, parent_folder_id` and after it: `markFoldersDirty(this.db, missingMedia.map((m) => m.parent_folder_id));`.

- [ ] **Step 4: Context/server** — `AppContext.stacks: StackService`; in `server.ts` construct `const stacks = new StackService(db, bootstrapLogger, settingsRepo);` and pass `onIdle: () => (scanner.isRunning() ? 0 : stacks.recomputeDirty(5))` to the worker; test helper `app.ts` adds `stacks: new StackService(db, logger, new SettingsRepo(db))`.

- [ ] **Step 5: decorate + collapse** — `server/src/api/decorate-media.ts`:
```ts
import type { MediaDto } from "@memorylane/shared";
import type { AppContext } from "../context.js";
import { EngagementRepo } from "../db/engagement-repo.js";

// Everything a listing must add on top of toMediaDto - favorites and stack
// membership - in one call so no route forgets one of them.
export function decorateMedia(ctx: AppContext, items: MediaDto[]): MediaDto[] {
  new EngagementRepo(ctx.db).attachFavorites(items);
  ctx.stacks.attachStacks(items);
  return items;
}
```
Replace every `engagement.attachFavorites(X)` in `folders-routes.ts`, `favorites-routes.ts`, `search-routes.ts`, `media-routes.ts` (list + get), `memories-routes.ts`, `home-routes.ts` with `decorateMedia(ctx, X)` (drop the now-unused `EngagementRepo` instances where nothing else uses them; `media-routes.ts` still needs `engagement` for favorite/shown/viewed).
Collapse: `folders-routes.ts` `/media` → `buildMediaQuery({ scope…, type, collapseStacks: !expandStacks })`; `home-routes.ts` hero and `random-selection-service.ts` eligibility → add `collapseStacks: true`; `memories-routes.ts` ELIGIBLE → `collapseStacks: true`.

- [ ] **Step 6: Settings route** — after `repo.update(parsed.data)`, if `parsed.data.stackGapSeconds !== undefined || parsed.data.stackMaxHamming !== undefined` call `ctx.stacks.markAllDirty()` so new thresholds apply on the next idle pass.

Run `npm test --workspace=server && npm run typecheck` → PASS. Commit: `feat(stacks): phash analyzer, dirty-folder recompute, collapse in listings`.

---

### Task 7: Stack routes

**Files:** Create `server/src/api/stacks-routes.ts`, `server/test/api/stacks-routes.test.ts`; modify `app.ts`.

Endpoints (all `requireAuth`):
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/stacks/:id` | – | `StackDetailDto` (items decorated) |
| POST | `/api/stacks` | `CreateStackRequest` | `StackDto` (201) |
| POST | `/api/stacks/:id/cover` | `SetStackCoverRequest` | `StackDto` |
| POST | `/api/stacks/:id/split` | `SplitStackRequest` | `StackDto` (the new stack) |
| POST | `/api/stacks/:id/merge` | `MergeStacksRequest` | `StackDto` |
| DELETE | `/api/stacks/:id/members/:mediaId` | – | `{ stack: StackDto | null }` |
| DELETE | `/api/stacks/:id` | – | 204 |
| POST | `/api/stacks/recompute` | `RecomputeStacksRequest` | `{ folders: number }` (folders marked dirty; recompute happens on the worker's next idle pass) |

`StackError` → `reply.code(err.status).send({ error: err.message })`; wrap each handler with a small `withStackErrors(fn)` helper.

- [ ] **Step 1: Tests** — seed 3 same-folder photos via `seedMedia`; `POST /api/stacks` with 2 → 201 + `count 2`; `GET /api/stacks/:id` → items length 2 with `stack.isCover` true on the cover; `POST cover` with the other → coverMediaId changes; `POST /api/stacks` reusing a stacked id → 400; `GET /api/folders/:id/media` → total 2 (collapsed: cover + the third), `?expandStacks=true` → 3, and the cover item carries `stack: { count: 2, isCover: true }`; `DELETE members/:mediaId` → `{ stack: null }` (dissolved); `POST /api/stacks/recompute` → `{ folders: N }`; unauthenticated → 401.

- [ ] **Step 2: Implement** the routes per the table; register `registerStackRoutes` in `app.ts` after reports.

Run tests → PASS. Commit: `feat(stacks): stack API routes`.

---

### Task 8: Client — API wrapper, grid badge + selection, StackPanel, FolderPage, Settings

**Files:** modify `client/src/api/client.ts`, `client/src/components/MediaGrid.tsx`, `client/src/pages/FolderPage.tsx`, `client/src/pages/SettingsPage.tsx`; create `client/src/components/StackPanel.tsx`.

- [ ] **Step 1: API wrapper** — `api.stacks = { get(id), create(mediaIds), setCover(id, mediaId), split(id, mediaIds), merge(id, fromId), removeMember(id, mediaId), remove(id), recompute(folderId?) }`; `api.folders.media(...)` gains an `expandStacks = false` arg appended as `&expandStacks=${expandStacks}`.

- [ ] **Step 2: MediaGrid** — new optional props:
```ts
  onOpenStack?: (media: MediaDto) => void;   // stack badge click (cover tiles only)
  selectable?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (media: MediaDto) => void;
```
Cover tiles render a top-right badge `<Layers size={12}/> {stack.count}` (`bg-black/70 text-white rounded px-1.5`) that calls `onOpenStack` and stops propagation. In `selectable` mode a tile click calls `onToggleSelect` instead of `onOpen`, shows a bottom-left check circle (`bg-accent` when selected, `bg-black/50` otherwise), and adds `ring-2 ring-accent` when selected.

- [ ] **Step 3: StackPanel** (`Modal` with `wide`): loads `api.stacks.get(id)`; header text "N photos · burst|manual"; a selectable `MediaGrid` of members; toolbar: **View** (opens `Viewer` on the members, starting at the first selected or 0), **Set as cover** (exactly 1 selected), **Split into new stack** (≥ 2 selected, < all), **Remove from stack** (≥ 1 selected; calls removeMember per id), **Delete stack** (confirm dialog via `window.confirm`). Every mutation re-fetches; if the stack dissolves (`null`), the panel closes. `onChanged` callback lets the page refetch its grid on close.

- [ ] **Step 4: FolderPage** — state `openStackId`, `selectMode`, `selectedIds`; header gains a **Select** toggle button (and, in select mode, `Stack N selected` (enabled at ≥ 2) + `Cancel`); `MediaGrid` receives `onOpenStack`, `selectable`, `selectedIds`, `onToggleSelect`; after `api.stacks.create` or panel close → reload media (`loadMedia(showAllFiles, mediaType)`).

- [ ] **Step 5: Settings › Stacks** — section after Analysis: two number inputs (`Burst gap (seconds)` step 0.5, `Visual similarity (max hash distance, 0–64)`) saved on blur via `updateSchedule({ stackGapSeconds })`-style patch; a **Recompute all stacks** button calling `api.stacks.recompute()` and showing "Queued N folders — stacks update in the background".

Run `npm run typecheck --workspace=client && npm run build --workspace=client` → clean. Commit: `feat(client): stack badge, stack panel, manual stacking, stack settings`.

---

### Task 9: Docs + verification + PR

- [ ] **Step 1: CLAUDE.md** — add a "### Stacks" subsection: tables, `groupBursts` rule + thresholds, dirty-folder flow (scanner/phash → `stack_dirty_folders` → worker idle → `recomputeDirty`), `user_modified`/`stack_exclusions` invariants, `collapseStacks` default per route, `decorateMedia` must be used by every listing route.
- [ ] **Step 2: Browser verification** (same fixture flow as Phase 1, plus): make the 6 osprey shots a burst — same `SerialNumber`, `DateTimeOriginal` 100 ms apart via `-SubSecTimeOriginal`, near-identical pixel content (same base colour with tiny noise); the 3 portraits 1 minute apart. After scan + a few idle seconds: folder grid shows 1 cover tile with badge "6" + others; expand → 6 members; set cover, remove one (grid badge → 5), delete stack (tiles return, `Recompute` doesn't re-stack them because of exclusions); Select mode → stack 2 portraits manually; Settings → thresholds save, recompute queues; Reports/Favorites/Search unaffected (expanded). Zero console errors.
- [ ] **Step 3: PR** against `feature/media-intelligence-phase1-exif`, body = summary + test plan + screenshots + the Claude Code trailer.

## Self-review

Spec §8.2 tables ✔ (T1, `phash` as TEXT — noted). §8.3 rules ✔ (T3: body/gap/hash-or-burst-id, exclusions and user-modified via T5 candidate filter, cover = first, per-folder wholesale replace). §8.1 `collapseStacks` ✔ (T4) with defaults: folder grid collapsed, Surprise Me/hero/memories collapsed, search/favorites/reports expanded. §8.5 ops ✔ (T5/T7/T8; merge is API-only in the UI — noted in PR). §12 settings ✔ (T4/T6/T8). Recompute trigger "after any scan that touched the folder (and on demand)" ✔ via dirty folders + idle hook (T6) and `/api/stacks/recompute` (T7). Viewer "left/right inside the stack first" — deferred (StackPanel's viewer covers the stack; noted).
