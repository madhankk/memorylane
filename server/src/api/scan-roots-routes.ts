import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  createScanRootRequestSchema,
  updateScanRootRequestSchema,
  type ScanRootDto,
} from "@memorylane/shared";
import type { AppContext } from "../context.js";

interface ScanRootRow {
  id: number;
  path: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function toDto(row: ScanRootRow): ScanRootDto {
  return {
    id: row.id,
    path: row.path,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function registerScanRootRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;

  app.get("/api/scan-roots", { preHandler: app.requireAuth }, async (_request, reply) => {
    const rows = db.prepare("SELECT * FROM scan_roots ORDER BY path").all() as ScanRootRow[];
    return reply.send(rows.map(toDto));
  });

  app.post("/api/scan-roots", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = createScanRootRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }

    const resolvedPath = path.resolve(parsed.data.path);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      return reply.code(400).send({ error: "Path does not exist or is not accessible" });
    }
    if (!stat.isDirectory()) {
      return reply.code(400).send({ error: "Path is not a directory" });
    }

    try {
      const info = db
        .prepare("INSERT INTO scan_roots (path, enabled) VALUES (?, 1)")
        .run(resolvedPath);
      const row = db.prepare("SELECT * FROM scan_roots WHERE id = ?").get(info.lastInsertRowid) as ScanRootRow;
      return reply.code(201).send(toDto(row));
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE")) {
        return reply.code(409).send({ error: "This path is already a scan root" });
      }
      throw err;
    }
  });

  app.put("/api/scan-roots/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateScanRootRequestSchema.safeParse(request.body);
    if (!parsed.success || Number.isNaN(id)) {
      return reply.code(400).send({ error: "Invalid input" });
    }
    const existing = db.prepare("SELECT * FROM scan_roots WHERE id = ?").get(id) as ScanRootRow | undefined;
    if (!existing) return reply.code(404).send({ error: "Scan root not found" });

    if (parsed.data.enabled !== undefined) {
      db.prepare("UPDATE scan_roots SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .run(parsed.data.enabled ? 1 : 0, id);
    }
    const updated = db.prepare("SELECT * FROM scan_roots WHERE id = ?").get(id) as ScanRootRow;
    return reply.send(toDto(updated));
  });

  app.delete("/api/scan-roots/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: "Invalid id" });
    // ON DELETE CASCADE removes associated folders/media rows; thumbnail files
    // for those media become orphaned and can be swept by a future cleanup job -
    // the cache is disposable by design, so this is a cosmetic disk-space concern only.
    db.prepare("DELETE FROM scan_roots WHERE id = ?").run(id);
    return reply.code(204).send();
  });
}
