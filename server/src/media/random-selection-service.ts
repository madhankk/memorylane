import type Database from "better-sqlite3";

// Isolated behind an interface so the sampling strategy can be swapped (e.g.
// for reservoir sampling or history-weighted "forgotten photos" selection)
// without touching the /api/memories route. See PLAN.md section 12.
export interface RandomSelectionService {
  getRandomMediaIds(count: number): number[];
}

export class SqliteRandomSelectionService implements RandomSelectionService {
  constructor(private db: Database.Database) {}

  getRandomMediaIds(count: number): number[] {
    // Photos only for v1 (Surprise Me excludes video per product spec section 20).
    const rows = this.db
      .prepare(
        `SELECT id FROM media
         WHERE status = 'active' AND media_type IN ('image', 'raw') AND thumbnail_status = 'done'
         ORDER BY RANDOM() LIMIT ?`,
      )
      .all(count) as { id: number }[];
    return rows.map((r) => r.id);
  }
}
