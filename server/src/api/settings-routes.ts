import type { FastifyInstance } from "fastify";
import { updateSettingsRequestSchema } from "@memorylane/shared";
import type { AppContext } from "../context.js";
import { SettingsRepo } from "../db/settings-repo.js";

export async function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const repo = new SettingsRepo(ctx.db);

  app.get("/api/settings", { preHandler: app.requireAuth }, async (_request, reply) => {
    return reply.send(repo.getAll());
  });

  app.put("/api/settings", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = updateSettingsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    return reply.send(repo.update(parsed.data));
  });
}
