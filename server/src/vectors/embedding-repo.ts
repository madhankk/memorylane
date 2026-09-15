import type Database from "better-sqlite3";

export function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

export function blobToVector(b: Buffer): Float32Array {
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer);
}

export interface EmbeddingRow {
  id: number;
  vector: Float32Array;
}

// media_embeddings access. SQLite is the durable store; the VectorIndex is a
// cache rebuilt from `iterate` when its row count disagrees.
export class EmbeddingRepo {
  constructor(private db: Database.Database) {}

  upsertMany(model: string, rows: { mediaId: number; vector: Float32Array }[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO media_embeddings (media_id, model, dim, vector, updated_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(media_id, model) DO UPDATE SET dim = excluded.dim, vector = excluded.vector, updated_at = excluded.updated_at`,
    );
    const tx = this.db.transaction((items: typeof rows) => {
      for (const r of items) stmt.run(r.mediaId, model, r.vector.length, vectorToBlob(r.vector));
    });
    tx(rows);
  }

  get(mediaId: number, model: string): Float32Array | null {
    const row = this.db.prepare("SELECT vector FROM media_embeddings WHERE media_id = ? AND model = ?").get(mediaId, model) as
      | { vector: Buffer }
      | undefined;
    return row ? blobToVector(row.vector) : null;
  }

  count(model: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM media_embeddings WHERE model = ?").get(model) as { c: number }).c;
  }

  dim(model: string): number | null {
    const row = this.db.prepare("SELECT dim FROM media_embeddings WHERE model = ? LIMIT 1").get(model) as { dim: number } | undefined;
    return row?.dim ?? null;
  }

  *iterate(model: string): Generator<EmbeddingRow> {
    const stmt = this.db.prepare("SELECT media_id, vector FROM media_embeddings WHERE model = ? ORDER BY media_id");
    for (const row of stmt.iterate(model) as IterableIterator<{ media_id: number; vector: Buffer }>) {
      yield { id: row.media_id, vector: blobToVector(row.vector) };
    }
  }

  deleteModel(model: string): number {
    return this.db.prepare("DELETE FROM media_embeddings WHERE model = ?").run(model).changes;
  }
}
