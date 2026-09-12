import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export async function registerScanRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { scanner } = ctx;

  app.post("/api/scans/run", { preHandler: app.requireAuth }, async (_request, reply) => {
    if (scanner.isRunning()) {
      return reply.code(409).send({ error: "A scan is already running" });
    }
    // Fire-and-forget: the scan can take a long time over large libraries, so
    // the client polls /api/scans/status rather than holding the connection open.
    scanner.runScan("manual").catch((err) => app.log.error({ err }, "Manual scan failed"));
    return reply.code(202).send({ ok: true });
  });

  app.get("/api/scans/status", { preHandler: app.requireAuth }, async (_request, reply) => {
    return reply.send(scanner.getStatus());
  });

  app.get("/api/scans/history", { preHandler: app.requireAuth }, async (_request, reply) => {
    return reply.send(scanner.getHistory());
  });
}
