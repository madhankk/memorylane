import type { FastifyInstance } from "fastify";
import { paginationQuerySchema, type FolderBreadcrumbDto } from "@memorylane/shared";
import type { AppContext } from "../context.js";
import { toFolderDto, toMediaDto, type FolderRow, type FolderCounts, type MediaRow } from "./mappers.js";

function getFolderCounts(ctx: AppContext, folderId: number): FolderCounts {
  const mediaCount = (
    ctx.db
      .prepare("SELECT COUNT(*) as c FROM media WHERE parent_folder_id = ? AND status = 'active'")
      .get(folderId) as { c: number }
  ).c;
  const childFolderCount = (
    ctx.db
      .prepare("SELECT COUNT(*) as c FROM folders WHERE parent_id = ? AND status = 'active'")
      .get(folderId) as { c: number }
  ).c;
  const thumbRow = ctx.db
    .prepare(
      `SELECT id FROM media WHERE parent_folder_id = ? AND status = 'active' AND thumbnail_status = 'done'
       ORDER BY captured_date DESC, id DESC LIMIT 1`,
    )
    .get(folderId) as { id: number } | undefined;

  return { mediaCount, childFolderCount, thumbnailMediaId: thumbRow?.id ?? null };
}

export async function registerFolderRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;

  app.get("/api/folders", { preHandler: app.requireAuth }, async (_request, reply) => {
    const rows = db
      .prepare("SELECT * FROM folders WHERE parent_id IS NULL AND status = 'active' ORDER BY name")
      .all() as FolderRow[];
    return reply.send(rows.map((row) => toFolderDto(row, getFolderCounts(ctx, row.id))));
  });

  app.get("/api/folders/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = db.prepare("SELECT * FROM folders WHERE id = ?").get(id) as FolderRow | undefined;
    if (!row) return reply.code(404).send({ error: "Folder not found" });

    const breadcrumbs: FolderBreadcrumbDto[] = [];
    let cursor: FolderRow | undefined = row;
    while (cursor) {
      breadcrumbs.unshift({ id: cursor.id, name: cursor.name });
      cursor = cursor.parent_id
        ? (db.prepare("SELECT * FROM folders WHERE id = ?").get(cursor.parent_id) as FolderRow | undefined)
        : undefined;
    }

    return reply.send({ folder: toFolderDto(row, getFolderCounts(ctx, row.id)), breadcrumbs });
  });

  app.get("/api/folders/:id/children", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = paginationQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    const { offset, limit } = parsed.data;

    const total = (
      db.prepare("SELECT COUNT(*) as c FROM folders WHERE parent_id = ? AND status = 'active'").get(id) as {
        c: number;
      }
    ).c;
    const rows = db
      .prepare("SELECT * FROM folders WHERE parent_id = ? AND status = 'active' ORDER BY name LIMIT ? OFFSET ?")
      .all(id, limit, offset) as FolderRow[];

    return reply.send({
      items: rows.map((row) => toFolderDto(row, getFolderCounts(ctx, row.id))),
      total,
      offset,
      limit,
    });
  });

  app.get("/api/folders/:id/media", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = paginationQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    const { offset, limit } = parsed.data;

    const total = (
      db.prepare("SELECT COUNT(*) as c FROM media WHERE parent_folder_id = ? AND status = 'active'").get(id) as {
        c: number;
      }
    ).c;
    const rows = db
      .prepare(
        `SELECT * FROM media WHERE parent_folder_id = ? AND status = 'active'
         ORDER BY captured_date IS NULL, captured_date, filename LIMIT ? OFFSET ?`,
      )
      .all(id, limit, offset) as MediaRow[];

    return reply.send({ items: rows.map(toMediaDto), total, offset, limit });
  });
}
