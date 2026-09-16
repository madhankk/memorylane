import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { APPLE_PHOTOS_PLUGIN_ID, applePhotosPluginStatus } from "./registry.js";

const updateSchema = z.object({ enabled: z.boolean() }).strict();

export async function registerPluginRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/plugins", { preHandler: app.requireAuth }, async (_request, reply) =>
    reply.send([applePhotosPluginStatus(ctx.db)]));

  app.put("/api/plugins/apple-photos", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    if (parsed.data.enabled && process.platform !== "darwin") {
      return reply.code(409).send({ error: "Apple Photos is available only on macOS" });
    }
    ctx.db.prepare(`INSERT INTO plugin_settings (id, enabled) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      .run(APPLE_PHOTOS_PLUGIN_ID, parsed.data.enabled ? 1 : 0);
    return reply.send(applePhotosPluginStatus(ctx.db));
  });
}
