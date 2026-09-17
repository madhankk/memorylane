import type Database from "better-sqlite3";
import { TagRepo } from "../../tags/tag-repo.js";
import { isMediaSourceVisible } from "../../plugins/registry.js";
import type { Analyzer } from "../types.js";

function readKeywords(json: string | null): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((part): part is string => typeof part === "string") : [];
  } catch { return []; }
}

export function createImportedTagAnalyzer(db: Database.Database): Analyzer {
  const tags = new TagRepo(db);
  const get = db.prepare(`SELECT mx.keywords_json AS exifKeywords, a.keywords_json AS appleKeywords
    FROM media m LEFT JOIN media_exif mx ON mx.media_id = m.id
    LEFT JOIN apple_photos_assets a ON a.media_id = m.id WHERE m.id = ?`);
  return {
    key: "import_tags",
    version: "keywords-v1",
    batchSize: 64,
    requires: ["exif_full"],
    appliesTo: `(
      (media.source_kind = 'apple-photos' AND EXISTS (SELECT 1 FROM apple_photos_assets a WHERE a.media_id = media.id))
      OR (EXISTS (SELECT 1 FROM media_exif mx WHERE mx.media_id = media.id)
        AND EXISTS (SELECT 1 FROM media_analysis ex WHERE ex.media_id = media.id AND ex.analyzer = 'exif_full'
          AND ex.status = 'done' AND ex.input_fingerprint = media.fingerprint))
    )`,
    run: async (rows) => rows.map((row) => {
      if (!isMediaSourceVisible(db, row.id)) return { mediaId: row.id, status: "unsupported" as const };
      const data = get.get(row.id) as { exifKeywords: string | null; appleKeywords: string | null } | undefined;
      tags.replaceImported(row.id, readKeywords(data?.appleKeywords ?? data?.exifKeywords ?? null));
      return { mediaId: row.id, status: "done" as const };
    }),
  };
}
