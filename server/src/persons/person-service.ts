import fs from "node:fs";
import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { FaceDto, PersonDto } from "@memorylane/shared";
import type { SettingsRepo } from "../db/settings-repo.js";
import type { AiProvider } from "../providers/types.js";
import { spaceFor, type VectorIndex } from "../vectors/vector-index.js";
import { FaceRepo, type FaceRow } from "./face-repo.js";

export class PersonError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface PersonRow {
  id: number;
  name: string | null;
  auto_label: string;
  cover_face_id: number | null;
  hidden: number;
  merged_into: number | null;
  face_count: number;
  media_count: number;
}

// Cosine threshold used when linking faces during discovery and when
// matching a new cluster against an existing person's centroid.
const DISCOVERY_LINK_THRESHOLD = 0.5;
const KNN = 20;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

function centroid(vs: Float32Array[]): Float32Array {
  const out = new Float32Array(vs[0].length);
  for (const v of vs) for (let i = 0; i < out.length; i++) out[i] += v[i];
  return normalize(out);
}

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const PERSON_SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM faces f WHERE f.person_id = p.id) AS face_count,
    (SELECT COUNT(DISTINCT f.media_id) FROM faces f WHERE f.person_id = p.id) AS media_count
  FROM persons p`;

// Identity management (design doc §10.2/10.3). Two automatic paths -
// incremental kNN assignment for each new face, and periodic discovery over
// unassigned faces - plus user corrections that both paths must respect:
// assigned_by='user' rows are never touched, rejections are never crossed.
export class PersonService {
  private faces: FaceRepo;

  constructor(
    private db: Database.Database,
    private logger: Logger,
    private settings: SettingsRepo,
    private provider: () => AiProvider | null,
    private index: VectorIndex,
    private facesDir: string,
  ) {
    this.faces = new FaceRepo(db);
  }

  private model(): string | null {
    return this.provider()?.expectedFaceModel ?? null;
  }

  private enabled(): boolean {
    const s = this.settings.getAll();
    return s.personsEnabled && s.aiEnabled && this.model() !== null;
  }

  // ---- automatic ------------------------------------------------------------

  async assignNewFaces(faceIds: number[]): Promise<number> {
    const model = this.model();
    if (!model || faceIds.length === 0 || !this.enabled()) return 0;
    const assigned = this.faces.assignedMap(model);
    if (assigned.size === 0) return 0;
    const threshold = this.settings.getAll().faceAssignThreshold;
    const space = spaceFor("faces", model);
    let count = 0;
    for (const row of this.faces.listByIds(faceIds)) {
      if (row.person_id !== null) continue;
      const rejected = this.faces.rejectionsFor(row.id);
      const hits = await this.index.search(space, this.faces.vector(row), KNN, { excludeIds: [row.id] });
      const best = hits.find((h) => assigned.has(h.id) && !rejected.has(assigned.get(h.id) as number));
      if (best && best.score >= threshold) {
        this.faces.setAssignment(row.id, assigned.get(best.id) as number, "auto", best.score);
        count++;
      }
    }
    return count;
  }

  needsDiscovery(): boolean {
    const model = this.model();
    return !!model && this.enabled() && this.faces.hasUndiscovered(model);
  }

  // Clusters every unassigned quality face; each cluster either joins an
  // existing person (centroid match) or becomes a new "Person N".
  async discover(): Promise<{ persons: number; assigned: number }> {
    const model = this.model();
    const provider = this.provider();
    if (!model || !provider || !this.enabled()) return { persons: 0, assigned: 0 };
    const { faceMinClusterSize, faceAssignThreshold } = this.settings.getAll();
    const rows = this.faces.unassignedQuality(model);
    if (rows.length === 0) return { persons: 0, assigned: 0 };
    const vectors = rows.map((r) => this.faces.vector(r));
    const labels = await provider.cluster(vectors, { threshold: DISCOVERY_LINK_THRESHOLD, minClusterSize: faceMinClusterSize });

    const existing = (this.db.prepare("SELECT id FROM persons WHERE merged_into IS NULL").all() as { id: number }[]).map((p) => ({
      id: p.id,
      centroid: (() => {
        const vs = this.faces.personVectors(p.id);
        return vs.length ? centroid(vs) : null;
      })(),
    }));

    const clusters = new Map<number, number[]>();
    labels.forEach((l, i) => {
      if (l >= 0) clusters.set(l, [...(clusters.get(l) ?? []), i]);
    });

    let persons = 0, assigned = 0;
    const tx = this.db.transaction(() => {
      for (const members of clusters.values()) {
        const c = centroid(members.map((i) => vectors[i]));
        let personId: number | null = null;
        let bestScore = faceAssignThreshold;
        for (const e of existing) {
          if (!e.centroid) continue;
          const s = cosine(c, e.centroid);
          if (s >= bestScore) { bestScore = s; personId = e.id; }
        }
        if (personId === null) {
          personId = this.createPerson(rows[members[0]].id);
          persons++;
          existing.push({ id: personId, centroid: c });
        }
        // Cover = highest-quality member when the person is new.
        const cover = members.map((i) => rows[i]).sort((a, b) => b.quality - a.quality)[0];
        for (const i of members) {
          const row = rows[i];
          if (this.faces.rejectionsFor(row.id).has(personId)) continue;
          this.faces.setAssignment(row.id, personId, "auto", cosine(vectors[i], c));
          assigned++;
        }
        const p = this.db.prepare("SELECT cover_face_id FROM persons WHERE id = ?").get(personId) as { cover_face_id: number | null };
        if (p.cover_face_id === null) this.db.prepare("UPDATE persons SET cover_face_id = ? WHERE id = ?").run(cover.id, personId);
      }
      this.faces.markDiscovered(rows.map((r) => r.id));
    });
    tx();
    if (persons || assigned) this.logger.info({ persons, assigned, considered: rows.length }, "Person discovery finished");
    return { persons, assigned };
  }

  // Called from the worker's idle hook; cheap when there's nothing to do.
  async discoverIfNeeded(): Promise<number> {
    if (!this.needsDiscovery()) return 0;
    const r = await this.discover();
    return r.persons + r.assigned + 1;
  }

  private createPerson(coverFaceId: number | null): number {
    const next = ((this.db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM persons").get() as { m: number }).m ?? 0) + 1;
    const info = this.db.prepare("INSERT INTO persons (auto_label, cover_face_id) VALUES (?, ?)").run(`Person ${next}`, coverFaceId);
    return Number(info.lastInsertRowid);
  }

  // ---- reads ------------------------------------------------------------------

  private toPerson(row: PersonRow): PersonDto {
    return {
      id: row.id,
      name: row.name,
      autoLabel: row.auto_label,
      displayName: row.name ?? row.auto_label,
      coverFaceId: row.cover_face_id,
      faceCount: row.face_count,
      mediaCount: row.media_count,
      hidden: row.hidden === 1,
    };
  }

  toFace(row: FaceRow): FaceDto {
    return {
      id: row.id,
      mediaId: row.media_id,
      bbox: [row.bbox_x, row.bbox_y, row.bbox_w, row.bbox_h],
      detScore: row.det_score,
      quality: row.quality,
      personId: row.person_id,
      assignedBy: row.assigned_by as FaceDto["assignedBy"],
    };
  }

  listPersons(includeHidden: boolean): PersonDto[] {
    const rows = this.db
      .prepare(`${PERSON_SELECT} WHERE p.merged_into IS NULL ${includeHidden ? "" : "AND p.hidden = 0"} ORDER BY (p.name IS NOT NULL), face_count DESC, p.id`)
      .all() as PersonRow[];
    return rows.map((r) => this.toPerson(r));
  }

  getPerson(id: number): PersonDto | null {
    const row = this.db.prepare(`${PERSON_SELECT} WHERE p.id = ?`).get(id) as PersonRow | undefined;
    if (!row) return null;
    if (row.merged_into !== null) return this.getPerson(row.merged_into);
    return this.toPerson(row);
  }

  private requirePerson(id: number): PersonDto {
    const p = this.getPerson(id);
    if (!p) throw new PersonError(404, "Person not found");
    return p;
  }

  listFaces(personId: number, limit: number, offset: number): FaceDto[] {
    return this.faces.listForPerson(personId, limit, offset).map((r) => this.toFace(r));
  }

  facesForMedia(mediaId: number): FaceDto[] {
    return this.faces.listForMedia(mediaId).map((r) => this.toFace(r));
  }

  getFace(faceId: number): FaceRow | null {
    return this.faces.get(faceId);
  }

  // ---- user corrections --------------------------------------------------------

  rename(id: number, name: string | null): PersonDto {
    this.requirePerson(id);
    this.db.prepare(`UPDATE persons SET name = ?, updated_at = ${NOW} WHERE id = ?`).run(name, id);
    return this.requirePerson(id);
  }

  setHidden(id: number, hidden: boolean): PersonDto {
    this.requirePerson(id);
    this.db.prepare(`UPDATE persons SET hidden = ?, updated_at = ${NOW} WHERE id = ?`).run(hidden ? 1 : 0, id);
    return this.requirePerson(id);
  }

  merge(intoId: number, fromId: number): PersonDto {
    if (intoId === fromId) throw new PersonError(400, "Cannot merge a person into themselves");
    this.requirePerson(intoId);
    this.requirePerson(fromId);
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE faces SET person_id = ? WHERE person_id = ?").run(intoId, fromId);
      this.db.prepare("INSERT OR IGNORE INTO face_person_rejections (face_id, person_id) SELECT face_id, ? FROM face_person_rejections WHERE person_id = ?").run(intoId, fromId);
      this.db.prepare("DELETE FROM face_person_rejections WHERE person_id = ?").run(fromId);
      this.db.prepare(`UPDATE persons SET merged_into = ?, hidden = 1, updated_at = ${NOW} WHERE id = ?`).run(intoId, fromId);
    });
    tx();
    return this.requirePerson(intoId);
  }

  // Explicit user decision: this face IS that person (or nobody).
  assignFace(faceId: number, personId: number | null): FaceDto {
    const face = this.faces.get(faceId);
    if (!face) throw new PersonError(404, "Face not found");
    if (personId !== null) this.requirePerson(personId);
    const tx = this.db.transaction(() => {
      if (personId === null && face.person_id !== null) this.faces.addRejection(faceId, face.person_id);
      if (personId !== null) this.db.prepare("DELETE FROM face_person_rejections WHERE face_id = ? AND person_id = ?").run(faceId, personId);
      this.faces.setAssignment(faceId, personId, personId === null ? null : "user", personId === null ? null : 1);
    });
    tx();
    return this.toFace(this.faces.get(faceId) as FaceRow);
  }

  // "Not this person": unassign if that's who they are, remember the rejection.
  rejectFace(faceId: number, personId: number): FaceDto {
    const face = this.faces.get(faceId);
    if (!face) throw new PersonError(404, "Face not found");
    const tx = this.db.transaction(() => {
      this.faces.addRejection(faceId, personId);
      if (face.person_id === personId) this.faces.setAssignment(faceId, null, null, null);
    });
    tx();
    return this.toFace(this.faces.get(faceId) as FaceRow);
  }

  // One action, everything gone: rows, vectors, crops. Analysis rows go back
  // to pending so re-enabling People re-detects from scratch.
  async deleteAllFaceData(): Promise<void> {
    const model = this.model();
    this.faces.deleteAll();
    this.db.prepare("UPDATE media_analysis SET status = 'pending', attempts = 0, error = NULL WHERE analyzer = 'faces'").run();
    if (model) await this.index.rebuild(spaceFor("faces", model), [], 0);
    fs.rmSync(this.facesDir, { recursive: true, force: true });
    fs.mkdirSync(this.facesDir, { recursive: true });
    this.logger.info("Deleted all face data");
  }
}
