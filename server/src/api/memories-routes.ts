import type { FastifyInstance } from "fastify";
import { randomMediaQuerySchema, type OnThisDayTier } from "@memorylane/shared";
import type { AppContext } from "../context.js";
import { toMediaDto, EXCLUDE_PAIRED_RAW, type MediaRow } from "./mappers.js";
import { EngagementRepo } from "../db/engagement-repo.js";

const ELIGIBLE_MEDIA_FILTER = `status = 'active' AND media_type IN ('image', 'raw') AND thumbnail_status = 'done' AND ${EXCLUDE_PAIRED_RAW}`;

export async function registerMemoriesRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, randomSelection } = ctx;
  const engagement = new EngagementRepo(db);

  app.get("/api/memories/random", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = randomMediaQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });

    const ids = randomSelection.getRandomMediaIds(parsed.data.count);
    if (ids.length === 0) return reply.send({ items: [] });

    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`SELECT * FROM media WHERE id IN (${placeholders})`).all(...ids) as MediaRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Preserve the already-shuffled order from the selection service - a plain
    // `WHERE id IN (...)` gives no ordering guarantee.
    const items = engagement.attachFavorites(
      ids.map((id) => byId.get(id)).filter((r): r is MediaRow => !!r).map(toMediaDto),
    );
    return reply.send({ items });
  });

  // "This Day, Another Time": degrades from exact day-of-year (across all
  // years) to the surrounding week to the whole month, using whichever tier
  // first turns up results. Not a hot path, so a couple of extra full scans
  // on a miss is an acceptable trade-off for the simplicity of trying each
  // tier as its own query rather than one clever combined one.
  app.get("/api/memories/on-this-day", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = randomMediaQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    const { count } = parsed.data;

    const dayRows = db
      .prepare(
        `SELECT id FROM media WHERE ${ELIGIBLE_MEDIA_FILTER} AND captured_date IS NOT NULL
         AND strftime('%m-%d', captured_date) = strftime('%m-%d', 'now')
         ORDER BY RANDOM() LIMIT ?`,
      )
      .all(count) as { id: number }[];

    let tier: OnThisDayTier = "day";
    let idRows = dayRows;

    if (idRows.length === 0) {
      tier = "week";
      idRows = db
        .prepare(
          `SELECT id FROM media WHERE ${ELIGIBLE_MEDIA_FILTER} AND captured_date IS NOT NULL
           AND MIN(
             ABS(CAST(strftime('%j', captured_date) AS INTEGER) - CAST(strftime('%j', 'now') AS INTEGER)),
             366 - ABS(CAST(strftime('%j', captured_date) AS INTEGER) - CAST(strftime('%j', 'now') AS INTEGER))
           ) <= 3
           ORDER BY RANDOM() LIMIT ?`,
        )
        .all(count) as { id: number }[];
    }

    if (idRows.length === 0) {
      tier = "month";
      idRows = db
        .prepare(
          `SELECT id FROM media WHERE ${ELIGIBLE_MEDIA_FILTER} AND captured_date IS NOT NULL
           AND strftime('%m', captured_date) = strftime('%m', 'now')
           ORDER BY RANDOM() LIMIT ?`,
        )
        .all(count) as { id: number }[];
    }

    if (idRows.length === 0) {
      return reply.send({ tier: "none", items: [] });
    }

    const ids = idRows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`SELECT * FROM media WHERE id IN (${placeholders})`).all(...ids) as MediaRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = engagement.attachFavorites(
      ids.map((id) => byId.get(id)).filter((r): r is MediaRow => !!r).map(toMediaDto),
    );

    return reply.send({ tier, items });
  });
}
