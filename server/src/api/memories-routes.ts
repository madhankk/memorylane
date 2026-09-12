import type { FastifyInstance } from "fastify";
import { randomMediaQuerySchema } from "@memorylane/shared";
import type { AppContext } from "../context.js";
import { toMediaDto, type MediaRow } from "./mappers.js";

export async function registerMemoriesRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, randomSelection } = ctx;

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
    const items = ids.map((id) => byId.get(id)).filter((r): r is MediaRow => !!r).map(toMediaDto);
    return reply.send({ items });
  });
}
