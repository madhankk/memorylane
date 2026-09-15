import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { AnalysisStatusDto, AnalysisStatus } from "@memorylane/shared";
import { AnalysisRepo } from "./analysis-repo.js";
import type { Analyzer } from "./types.js";

const EMPTY_COUNTS = (): Record<AnalysisStatus, number> => ({ pending: 0, running: 0, done: 0, failed: 0, unsupported: 0 });

// Drains media_analysis for every registered analyzer, in registration
// order. Polling loop rather than event-driven: work arrives in bulk (a scan,
// a startup backfill), and a 2s idle poll costs one indexed query.
// Yields entirely while a scan is running so thumbnail generation keeps its
// I/O budget (design doc §6.2).
export class AnalysisWorker {
  private repo: AnalysisRepo;
  private stopped = true;
  private loopPromise: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private needsEnqueue = false;
  private idleMs: number;
  private pausedMs: number;

  constructor(
    db: Database.Database,
    private logger: Logger,
    private analyzers: Analyzer[],
    private isPaused: () => boolean,
    opts: { idleMs?: number; pausedMs?: number } = {},
  ) {
    this.repo = new AnalysisRepo(db);
    this.idleMs = opts.idleMs ?? 2000;
    this.pausedMs = opts.pausedMs ?? 5000;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const reset = this.repo.resetRunning();
    if (reset > 0) this.logger.warn({ count: reset }, "Re-queued analysis rows interrupted by a restart");
    for (const a of this.analyzers) {
      const stale = this.repo.requeueStaleVersions(a);
      if (stale > 0) {
        this.logger.info({ analyzer: a.key, version: a.version, count: stale }, "Re-queued analysis rows from an older version");
      }
    }
    this.enqueueAll();
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.loopPromise;
    this.loopPromise = null;
  }

  // Called after a scan: new media needs queue rows, and the loop may be idle.
  kick(): void {
    this.needsEnqueue = true;
    this.wake?.();
  }

  enqueueAll(): number {
    let total = 0;
    for (const a of this.analyzers) total += this.repo.ensureQueued(a);
    if (total > 0) this.logger.info({ count: total }, "Queued media for analysis");
    return total;
  }

  retryFailed(analyzerKey?: string): number {
    const n = this.repo.retryFailed(analyzerKey);
    this.wake?.();
    return n;
  }

  // One pass: for each analyzer, claim and process one batch. Returns the
  // number of rows processed so callers (and tests) can tell idle from busy.
  async runOnce(): Promise<number> {
    let processed = 0;
    for (const a of this.analyzers) {
      if (this.stopped && this.loopPromise) break;
      const rows = this.repo.claimBatch(a.key, a.batchSize);
      if (rows.length === 0) continue;
      try {
        const outcomes = await a.run(rows);
        this.repo.complete(a.key, a.version, outcomes);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error({ err, analyzer: a.key, count: rows.length }, "Analyzer batch failed");
        this.repo.complete(a.key, a.version, rows.map((r) => ({ mediaId: r.id, status: "failed" as const, error: message })));
      }
      processed += rows.length;
    }
    return processed;
  }

  getStatus(): AnalysisStatusDto {
    const byKey = new Map(this.analyzers.map((a) => [a.key, { key: a.key, version: a.version, counts: EMPTY_COUNTS() }]));
    for (const row of this.repo.counts()) {
      const entry = byKey.get(row.analyzer);
      if (entry) entry.counts[row.status] = row.count;
    }
    return { paused: this.isPaused(), analyzers: [...byKey.values()] };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      t.unref();
      this.wake = () => {
        clearTimeout(t);
        this.wake = null;
        resolve();
      };
    });
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      if (this.isPaused()) {
        await this.sleep(this.pausedMs);
        continue;
      }
      if (this.needsEnqueue) {
        this.needsEnqueue = false;
        this.enqueueAll();
      }
      let processed = 0;
      try {
        processed = await this.runOnce();
      } catch (err) {
        this.logger.error({ err }, "Analysis loop iteration failed");
      }
      if (processed === 0) await this.sleep(this.idleMs);
    }
  }
}
