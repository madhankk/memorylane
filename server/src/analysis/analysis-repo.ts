import type Database from "better-sqlite3";
import type { Analyzer, AnalyzerOutcome, AnalysisMediaRow, AnalysisStatus } from "./types.js";

// A row that fails this many times stays 'failed' until an explicit retry
// (Settings > Analysis > Retry failed) - a poison file must not loop forever.
export const MAX_ATTEMPTS = 3;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export class AnalysisRepo {
  constructor(private db: Database.Database) {}

  // Pending rows for every active media item the analyzer applies to that
  // has no row yet. Safe to call repeatedly (PK conflict = ignored).
  ensureQueued(a: Analyzer): number {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO media_analysis (media_id, analyzer, status, updated_at)
         SELECT id, ?, 'pending', ${NOW} FROM media
         WHERE status = 'active' AND (${a.appliesTo})`,
      )
      .run(a.key);
    return info.changes;
  }

  requeueStaleVersions(a: Analyzer): number {
    return this.db
      .prepare(
        `UPDATE media_analysis SET status = 'pending', attempts = 0, error = NULL, updated_at = ${NOW}
         WHERE analyzer = ? AND status = 'done' AND (model_version IS NULL OR model_version != ?)`,
      )
      .run(a.key, a.version).changes;
  }

  // Used by the scan path, which produces the analyzer's result inline
  // (e.g. media_exif written by processMediaItem) without going through the queue.
  markDone(mediaId: number, analyzerKey: string, version: string): void {
    this.db
      .prepare(
        `INSERT INTO media_analysis (media_id, analyzer, status, model_version, input_fingerprint, attempts, error, updated_at)
         VALUES (?, ?, 'done', ?, (SELECT fingerprint FROM media WHERE id = ?), 0, NULL, ${NOW})
         ON CONFLICT(media_id, analyzer) DO UPDATE SET
           status = 'done', model_version = excluded.model_version, input_fingerprint = excluded.input_fingerprint,
           attempts = 0, error = NULL, updated_at = excluded.updated_at`,
      )
      .run(mediaId, analyzerKey, version, mediaId);
  }

  // The file changed on disk (fingerprint mismatch) - every analyzer's result is stale.
  resetForMedia(mediaId: number): void {
    this.db
      .prepare(`UPDATE media_analysis SET status = 'pending', attempts = 0, error = NULL, updated_at = ${NOW} WHERE media_id = ?`)
      .run(mediaId);
  }

  claimBatch(analyzerKey: string, limit: number): AnalysisMediaRow[] {
    const claim = this.db.transaction((): AnalysisMediaRow[] => {
      const rows = this.db
        .prepare(
          `SELECT media.id, media.parent_folder_id, media.absolute_path, media.media_type
           FROM media_analysis ma JOIN media ON media.id = ma.media_id
           WHERE ma.analyzer = ? AND ma.status = 'pending' AND media.status = 'active'
           ORDER BY ma.media_id LIMIT ?`,
        )
        .all(analyzerKey, limit) as AnalysisMediaRow[];
      if (rows.length === 0) return rows;
      const placeholders = rows.map(() => "?").join(",");
      this.db
        .prepare(`UPDATE media_analysis SET status = 'running', updated_at = ${NOW} WHERE analyzer = ? AND media_id IN (${placeholders})`)
        .run(analyzerKey, ...rows.map((r) => r.id));
      return rows;
    });
    return claim();
  }

  complete(analyzerKey: string, version: string, outcomes: AnalyzerOutcome[]): void {
    const done = this.db.prepare(
      `UPDATE media_analysis SET status = ?, model_version = ?, input_fingerprint = (SELECT fingerprint FROM media WHERE id = media_analysis.media_id),
         attempts = attempts + 1, error = NULL, updated_at = ${NOW}
       WHERE media_id = ? AND analyzer = ?`,
    );
    const failed = this.db.prepare(
      `UPDATE media_analysis SET
         attempts = attempts + 1,
         status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
         error = ?, updated_at = ${NOW}
       WHERE media_id = ? AND analyzer = ?`,
    );
    const tx = this.db.transaction((items: AnalyzerOutcome[]) => {
      for (const o of items) {
        if (o.status === "failed") failed.run(o.error ?? "unknown error", o.mediaId, analyzerKey);
        else done.run(o.status, version, o.mediaId, analyzerKey);
      }
    });
    tx(outcomes);
  }

  // Nothing survives a process restart, so 'running' can only mean "was
  // interrupted" at startup - same reasoning as TranscodeWorker.reconcileAndResume.
  resetRunning(): number {
    return this.db
      .prepare(`UPDATE media_analysis SET status = 'pending', updated_at = ${NOW} WHERE status = 'running'`)
      .run().changes;
  }

  retryFailed(analyzerKey?: string): number {
    const sql = `UPDATE media_analysis SET status = 'pending', attempts = 0, error = NULL, updated_at = ${NOW}
                 WHERE status IN ('failed', 'unsupported')${analyzerKey ? " AND analyzer = ?" : ""}`;
    const stmt = this.db.prepare(sql);
    return (analyzerKey ? stmt.run(analyzerKey) : stmt.run()).changes;
  }

  counts(): { analyzer: string; status: AnalysisStatus; count: number }[] {
    return this.db
      .prepare("SELECT analyzer, status, COUNT(*) as count FROM media_analysis GROUP BY analyzer, status ORDER BY analyzer, status")
      .all() as { analyzer: string; status: AnalysisStatus; count: number }[];
  }
}
