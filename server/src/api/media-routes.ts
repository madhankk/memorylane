import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { toMediaDto, type MediaRow } from "./mappers.js";
import { thumbnailPathForMediaId } from "../config/paths.js";
import { streamFile, mimeTypeForExtension } from "./file-streaming.js";

interface MediaWithRootRow extends MediaRow {
  scan_root_path: string;
  scan_root_enabled: number;
}

// Central safe-lookup: resolves a media id to a verified, on-disk, enabled-root
// path. Never trusts a path from the request - only the database. See spec
// section 24 (Safe File Serving).
function resolveVerifiedMedia(ctx: AppContext, id: number): MediaWithRootRow | null {
  const row = ctx.db
    .prepare(
      `SELECT media.*, scan_roots.path as scan_root_path, scan_roots.enabled as scan_root_enabled
       FROM media JOIN scan_roots ON scan_roots.id = media.scan_root_id
       WHERE media.id = ?`,
    )
    .get(id) as MediaWithRootRow | undefined;
  if (!row) return null;
  if (!row.scan_root_enabled || row.status !== "active") return null;

  const resolvedPath = path.resolve(row.absolute_path);
  const resolvedRoot = path.resolve(row.scan_root_path);
  if (!resolvedPath.startsWith(resolvedRoot)) return null; // defense in depth

  return row;
}

export async function registerMediaRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, paths } = ctx;

  app.get("/api/media/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = db.prepare("SELECT * FROM media WHERE id = ?").get(id) as MediaRow | undefined;
    if (!row) return reply.code(404).send({ error: "Media not found" });
    return reply.send(toMediaDto(row));
  });

  app.get("/api/media/:id/file", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const media = resolveVerifiedMedia(ctx, id);
    if (!media) return reply.code(404).send({ error: "Media not found" });
    if (!fs.existsSync(media.absolute_path)) return reply.code(404).send({ error: "File missing on disk" });

    return streamFile(request, reply, media.absolute_path, mimeTypeForExtension(media.extension));
  });

  app.get("/api/media/:id/thumbnail", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const media = resolveVerifiedMedia(ctx, id);
    if (!media) return reply.code(404).send({ error: "Media not found" });

    const thumbPath = thumbnailPathForMediaId(paths.thumbnailsDir, id);
    if (media.thumbnail_status !== "done" || !fs.existsSync(thumbPath)) {
      return reply.code(404).send({ error: "Thumbnail not available" });
    }
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    return streamFile(request, reply, thumbPath, "image/jpeg");
  });
}
