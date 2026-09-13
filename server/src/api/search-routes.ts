import type { FastifyInstance } from "fastify";
import { searchQuerySchema, type SearchResultDto } from "@memorylane/shared";
import type { AppContext } from "../context.js";
import { toFolderDto, toMediaDto, type FolderRow, type MediaRow } from "./mappers.js";
import { EngagementRepo } from "../db/engagement-repo.js";

// Builds a safe FTS5 MATCH expression from free-text user input: each
// whitespace-separated term becomes a quoted prefix match, ANDed together.
// Quoting neutralizes FTS5's special query syntax (AND/OR/NOT/NEAR/*, etc.)
// so user input can never be interpreted as FTS operators.
function buildFtsQuery(q: string): string {
  const terms = q.trim().split(/\s+/).filter(Boolean);
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" AND ");
}

export async function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;
  const engagement = new EngagementRepo(db);

  app.get("/api/search", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    const { q, offset, limit } = parsed.data;
    const ftsQuery = buildFtsQuery(q);
    if (!ftsQuery) return reply.send({ items: [], total: 0, offset, limit });

    const folderLimit = Math.min(20, limit);
    const folderRows = db
      .prepare(
        `SELECT folders.* FROM folders_fts
         JOIN folders ON folders.id = folders_fts.rowid
         WHERE folders_fts MATCH ? AND folders.status = 'active'
         ORDER BY rank LIMIT ?`,
      )
      .all(ftsQuery, folderLimit) as FolderRow[];

    const mediaLimit = Math.max(0, limit - folderRows.length);
    const mediaRows = mediaLimit
      ? (db
          .prepare(
            `SELECT media.* FROM media_fts
             JOIN media ON media.id = media_fts.rowid
             WHERE media_fts MATCH ? AND media.status = 'active'
             ORDER BY rank LIMIT ? OFFSET ?`,
          )
          .all(ftsQuery, mediaLimit, offset) as MediaRow[])
      : [];

    const items: SearchResultDto[] = [
      ...folderRows.map((row) => {
        const thumb = db
          .prepare(
            "SELECT id, thumbnail_version FROM media WHERE parent_folder_id = ? AND status='active' AND thumbnail_status='done' ORDER BY RANDOM() LIMIT 1",
          )
          .get(row.id) as { id: number; thumbnail_version: number } | undefined;
        return {
          type: "folder" as const,
          folder: toFolderDto(row, {
            mediaCount: (db.prepare("SELECT COUNT(*) as c FROM media WHERE parent_folder_id = ? AND status='active'").get(row.id) as { c: number }).c,
            childFolderCount: (db.prepare("SELECT COUNT(*) as c FROM folders WHERE parent_id = ? AND status='active'").get(row.id) as { c: number }).c,
            thumbnailMediaId: thumb?.id ?? null,
            thumbnailVersion: thumb?.thumbnail_version ?? 0,
          }),
        };
      }),
      ...engagement
        .attachFavorites(mediaRows.map(toMediaDto))
        .map((media) => ({ type: "media" as const, media })),
    ];

    return reply.send({ items, total: items.length, offset, limit });
  });
}
