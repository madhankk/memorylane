import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "pino";
import type { AppContext } from "../context.js";
import { APPLE_PHOTOS_PLUGIN_ID, applePhotosPluginStatus } from "./registry.js";
import { isApplePhotosEnabled } from "./registry.js";

const updateSchema = z.object({ enabled: z.boolean() }).strict();

export async function registerPluginRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const activeSyncs = new Set<number>();
  ctx.db.prepare("UPDATE apple_photos_sync_state SET status = 'interrupted', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'running'").run();
  const readSync = (id: number) => {
    const row = ctx.db.prepare("SELECT status, processed, total, last_error AS error, started_at AS startedAt, finished_at AS finishedAt, last_success_at AS lastSuccessAt FROM apple_photos_sync_state WHERE scan_root_id = ?")
      .get(id);
    return row ?? { status: "idle", processed: 0, total: 0, error: null, startedAt: null, finishedAt: null, lastSuccessAt: null };
  };
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

  app.get("/api/plugins/apple-photos/health", { preHandler: app.requireAuth }, async (_request, reply) => {
    if (!isApplePhotosEnabled(ctx.db)) return reply.code(409).send({ error: "Apple Photos is disabled" });
    try {
      const { photosHelperHealth } = await import("./apple-photos/helper-client.js");
      return reply.send(await photosHelperHealth(ctx.paths.dataDir));
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : "Photos helper unavailable" });
    }
  });

  const resolveRoot = (id: number) => ctx.db.prepare("SELECT id, path, enabled FROM scan_roots WHERE id = ? AND kind = 'apple-photos'")
    .get(id) as { id: number; path: string; enabled: number } | undefined;

  app.get("/api/plugins/apple-photos/roots/:id/sync", { preHandler: app.requireAuth }, async (request, reply) => {
    if (!isApplePhotosEnabled(ctx.db)) return reply.code(409).send({ error: "Apple Photos is disabled" });
    const id = Number((request.params as { id: string }).id);
    if (!Number.isSafeInteger(id) || !resolveRoot(id)) return reply.code(404).send({ error: "Apple Photos root not found" });
    return reply.send(readSync(id));
  });

  app.post("/api/plugins/apple-photos/roots/:id/sync", { preHandler: app.requireAuth }, async (request, reply) => {
    if (!isApplePhotosEnabled(ctx.db)) return reply.code(409).send({ error: "Apple Photos is disabled" });
    const id = Number((request.params as { id: string }).id);
    const root = Number.isSafeInteger(id) ? resolveRoot(id) : undefined;
    if (!root) return reply.code(404).send({ error: "Apple Photos root not found" });
    if (!root.enabled) return reply.code(409).send({ error: "Apple Photos root is disabled" });
    if (activeSyncs.has(id)) return reply.code(409).send({ error: "Sync already running" });

    try {
      const { photosHelperHealth, fetchCatalogPage } = await import("./apple-photos/helper-client.js");
      await photosHelperHealth(ctx.paths.dataDir);
      const { syncAppleRoot } = await import("./apple-photos/sync.js");
      ctx.db.prepare(`INSERT INTO apple_photos_sync_state (scan_root_id, status, processed, total, last_error, started_at, finished_at)
        VALUES (?, 'running', 0, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL)
        ON CONFLICT(scan_root_id) DO UPDATE SET status = 'running', processed = 0, total = 0,
          last_error = NULL, started_at = excluded.started_at, finished_at = NULL`).run(id);
      activeSyncs.add(id);
      void syncAppleRoot(ctx.db, id,
        (cursor) => fetchCatalogPage(ctx.paths.dataDir, root.path, cursor),
        () => isApplePhotosEnabled(ctx.db) && resolveRoot(id)?.enabled === 1,
        async ({ mediaId, changed }) => {
          if (!changed || mediaId === null) return;
          const media = ctx.db.prepare("SELECT id, parent_folder_id, absolute_path, media_type FROM media WHERE id = ?")
            .get(mediaId) as { id: number; parent_folder_id: number; absolute_path: string; media_type: "image" | "raw" | "video" };
          const { processMediaItem } = await import("../media/media-processor.js");
          await processMediaItem(ctx.db, ctx.paths, app.log as unknown as Logger, media);
        },
        (processed, total) => {
          if (processed === 1 || processed % 25 === 0 || processed === total) {
            ctx.db.prepare("UPDATE apple_photos_sync_state SET processed = ?, total = ? WHERE scan_root_id = ?").run(processed, total, id);
          }
        })
        .then((result) => {
          ctx.db.prepare(`UPDATE apple_photos_sync_state SET status = ?, processed = ?, total = ?,
            finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            last_success_at = CASE WHEN ? = 0 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE last_success_at END
            WHERE scan_root_id = ?`).run(result.cancelled ? "cancelled" : "completed", result.processed, result.total, result.cancelled ? 1 : 0, id);
        })
        .catch((error: unknown) => {
          ctx.db.prepare(`UPDATE apple_photos_sync_state SET status = 'failed', last_error = ?,
            finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE scan_root_id = ?`)
            .run(error instanceof Error ? error.message : String(error), id);
        })
        .finally(() => { activeSyncs.delete(id); });
      return reply.code(202).send(readSync(id));
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : "Photos helper unavailable" });
    }
  });
}
