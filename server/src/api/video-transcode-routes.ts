import type { FastifyInstance } from "fastify";
import {
  startTranscodeRequestSchema,
  archiveTranscodedRequestSchema,
  type TranscodeCandidateDto,
} from "@memorylane/shared";
import type { AppContext } from "../context.js";
import { toMediaDto, toTranscodeJobDto, type MediaRow, type TranscodeJobRow } from "./mappers.js";
import { streamFile } from "./file-streaming.js";
import { transcodingPathForMediaId } from "../config/paths.js";
import { NEEDS_TRANSCODE_SQL_CLAUSE } from "../media/video-compatibility.js";

export async function registerVideoTranscodeRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, paths, transcodeWorker } = ctx;

  app.get("/api/scan-roots/:id/transcode-candidates", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const rows = db
      .prepare(
        `SELECT * FROM media WHERE scan_root_id = ? AND media_type = 'video' AND status = 'active' AND ${NEEDS_TRANSCODE_SQL_CLAUSE}
         ORDER BY captured_date IS NULL, captured_date, filename`,
      )
      .all(id) as MediaRow[];

    const jobRows = db
      .prepare(
        `SELECT vtj.* FROM video_transcode_jobs vtj JOIN media ON media.id = vtj.media_id WHERE media.scan_root_id = ?`,
      )
      .all(id) as TranscodeJobRow[];
    const jobsByMediaId = new Map(jobRows.map((j) => [j.media_id, j]));

    const candidates: TranscodeCandidateDto[] = rows.map((row) => ({
      media: toMediaDto(row),
      job: jobsByMediaId.has(row.id) ? toTranscodeJobDto(jobsByMediaId.get(row.id)!) : null,
    }));
    return reply.send(candidates);
  });

  app.post("/api/scan-roots/:id/transcode/start", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = startTranscodeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    transcodeWorker.startTranscode(parsed.data.mediaIds, parsed.data.quality);
    return reply.send({ ok: true });
  });

  app.get("/api/scan-roots/:id/transcode/status", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const rows = db
      .prepare(
        `SELECT vtj.* FROM video_transcode_jobs vtj JOIN media ON media.id = vtj.media_id WHERE media.scan_root_id = ?`,
      )
      .all(id) as TranscodeJobRow[];
    return reply.send(rows.map(toTranscodeJobDto));
  });

  app.post("/api/scan-roots/:id/transcode/archive", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = archiveTranscodedRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const result = await transcodeWorker.archive(parsed.data.mediaIds);
    return reply.send(result);
  });

  // Preview a transcode's local-cache output before deciding to archive it -
  // separate from the normal /api/media/:id/file (which serves the indexed
  // original) since the new file isn't indexed media until Archive runs.
  app.get("/api/media/:id/transcode-preview", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const job = db.prepare(`SELECT * FROM video_transcode_jobs WHERE media_id = ? AND status = 'done'`).get(id) as
      | TranscodeJobRow
      | undefined;
    if (!job) return reply.code(404).send({ error: "No transcoded preview available" });
    return streamFile(request, reply, transcodingPathForMediaId(paths.transcodingDir, id), "video/mp4");
  });
}
