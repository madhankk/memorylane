import * as lancedb from "@lancedb/lancedb";
import type { VectorHit, VectorIndex, VectorRow } from "./vector-index.js";

const REBUILD_CHUNK = 5000;

// Table names must be filesystem-safe; a space like "media:clip-vit-base-patch32@1"
// becomes "media__clip-vit-base-patch32_1".
function tableName(space: string): string {
  return space.replace(/:/g, "__").replace(/[^A-Za-z0-9_.-]/g, "_");
}

// Embedded LanceDB under <data-dir>/vectors. One table per space, flat
// (brute-force) search - fast enough well past 100k rows; an IVF-PQ index is
// a one-line addition once a space outgrows that.
export class LanceVectorIndex implements VectorIndex {
  private conn: Promise<lancedb.Connection> | null = null;
  // Serialises writes per space: LanceDB commits are optimistic and two
  // concurrent mergeInserts on one table would conflict.
  private locks = new Map<string, Promise<unknown>>();

  constructor(private dir: string) {}

  private connect(): Promise<lancedb.Connection> {
    if (!this.conn) this.conn = lancedb.connect(this.dir);
    return this.conn;
  }

  private async table(space: string): Promise<lancedb.Table | null> {
    const db = await this.connect();
    const names = await db.tableNames();
    return names.includes(tableName(space)) ? db.openTable(tableName(space)) : null;
  }

  private locked<T>(space: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(space) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(space, next.catch(() => undefined));
    return next;
  }

  private toRecords(rows: VectorRow[]): Record<string, unknown>[] {
    return rows.map((r) => ({ id: r.id, vector: Array.from(r.vector) }));
  }

  async upsert(space: string, rows: VectorRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.locked(space, async () => {
      const db = await this.connect();
      const existing = await this.table(space);
      if (!existing) {
        await db.createTable(tableName(space), this.toRecords(rows));
        return;
      }
      await existing.mergeInsert("id").whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(this.toRecords(rows));
    });
  }

  async remove(space: string, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.locked(space, async () => {
      const t = await this.table(space);
      if (t) await t.delete(`id IN (${ids.join(",")})`);
    });
  }

  async search(space: string, query: Float32Array, k: number, opts: { excludeIds?: number[] } = {}): Promise<VectorHit[]> {
    const t = await this.table(space);
    if (!t) return [];
    const exclude = new Set(opts.excludeIds ?? []);
    const rows = (await t
      .vectorSearch(Array.from(query))
      .distanceType("cosine")
      .limit(k + exclude.size)
      .toArray()) as { id: number; _distance: number }[];
    return rows
      .filter((r) => !exclude.has(Number(r.id)))
      .slice(0, k)
      .map((r) => ({ id: Number(r.id), score: 1 - r._distance }));
  }

  async count(space: string): Promise<number> {
    const t = await this.table(space);
    return t ? t.countRows() : 0;
  }

  async rebuild(space: string, rows: Iterable<VectorRow>, dim: number): Promise<void> {
    await this.locked(space, async () => {
      const db = await this.connect();
      let table: lancedb.Table | null = null;
      let chunk: VectorRow[] = [];
      const flush = async () => {
        if (chunk.length === 0) return;
        if (!table) table = await db.createTable(tableName(space), this.toRecords(chunk), { mode: "overwrite" });
        else await table.add(this.toRecords(chunk));
        chunk = [];
      };
      for (const row of rows) {
        chunk.push(row);
        if (chunk.length >= REBUILD_CHUNK) await flush();
      }
      await flush();
      if (!table) {
        // Nothing to index: drop any stale table so counts agree.
        if ((await db.tableNames()).includes(tableName(space))) await db.dropTable(tableName(space));
      }
      void dim;
    });
  }

  async ensureSynced(space: string, expectedCount: number, rows: () => Iterable<VectorRow>, dim: number | null): Promise<"ok" | "rebuilt"> {
    const have = await this.count(space);
    if (have === expectedCount) return "ok";
    await this.rebuild(space, rows(), dim ?? 0);
    return "rebuilt";
  }
}
