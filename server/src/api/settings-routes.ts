import type { FastifyInstance } from "fastify";
import { updateSettingsRequestSchema, type StorageStatsDto } from "@memorylane/shared";
import type { AppContext } from "../context.js";
import { SettingsRepo } from "../db/settings-repo.js";
import { getDirectorySize, getFileSize } from "../util/dir-size.js";

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

  // Disk usage of MemoryLane's own disposable app-data directory (thumbnail
  // cache, database, logs) - entirely separate from the source photo library.
  app.get("/api/settings/storage", { preHandler: app.requireAuth }, async (_request, reply) => {
    const { paths } = ctx;
    const [thumbnailCacheBytes, databaseBytes, walBytes, shmBytes, logsBytes] = await Promise.all([
      getDirectorySize(paths.thumbnailsDir),
      getFileSize(paths.dbPath),
      getFileSize(`${paths.dbPath}-wal`),
      getFileSize(`${paths.dbPath}-shm`),
      getDirectorySize(paths.logsDir),
    ]);
    const databaseTotal = databaseBytes + walBytes + shmBytes;

    const stats: StorageStatsDto = {
      thumbnailCacheBytes,
      databaseBytes: databaseTotal,
      logsBytes,
      totalBytes: thumbnailCacheBytes + databaseTotal + logsBytes,
    };
    return reply.send(stats);
  });
}
