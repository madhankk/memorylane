import fs from "node:fs";
import type Database from "better-sqlite3";
import { thumbnailPathForMediaId, type AppPaths } from "../../config/paths.js";
import { ProviderUnavailableError, type EmbeddingProvider } from "../../providers/types.js";
import { EmbeddingRepo } from "../../vectors/embedding-repo.js";
import { spaceFor, type VectorIndex } from "../../vectors/vector-index.js";
import { markFoldersDirty } from "../../stacks/dirty.js";
import type { Analyzer, AnalysisMediaRow, AnalyzerOutcome } from "../types.js";

export const EMBED_IMAGE_KEY = "embed_image";

// Embeds the existing 500px thumbnail (CLIP downsamples to 224px anyway, so
// re-decoding originals would cost 10x for nothing). Applies to everything
// with a thumbnail - video posters included, so "describe it" search finds
// clips too. Writes SQLite (durable) then the vector index (cache).
export function createEmbedImageAnalyzer(
  db: Database.Database,
  paths: AppPaths,
  provider: EmbeddingProvider,
  index: VectorIndex,
  isEnabled: () => boolean,
): Analyzer {
  const repo = new EmbeddingRepo(db);
  return {
    key: EMBED_IMAGE_KEY,
    version: provider.expectedModel,
    batchSize: 16,
    appliesTo: "thumbnail_status = 'done'",
    isEnabled,
    async run(rows: AnalysisMediaRow[]): Promise<AnalyzerOutcome[]> {
      const health = await provider.health();
      if (!health.reachable) throw new ProviderUnavailableError(health.lastError ?? "Sidecar not reachable");

      const outcomes = new Map<number, AnalyzerOutcome>();
      const inputs: { row: AnalysisMediaRow; jpeg: Buffer }[] = [];
      for (const row of rows) {
        const thumb = thumbnailPathForMediaId(paths.thumbnailsDir, row.id);
        if (!fs.existsSync(thumb)) {
          outcomes.set(row.id, { mediaId: row.id, status: "unsupported", error: "No thumbnail on disk" });
          continue;
        }
        inputs.push({ row, jpeg: fs.readFileSync(thumb) });
      }

      if (inputs.length > 0) {
        const batch = await provider.embedImages(inputs.map((i) => i.jpeg)); // throws ProviderUnavailableError on outages
        if (batch.vectors.length !== inputs.length) throw new Error(`Sidecar returned ${batch.vectors.length} vectors for ${inputs.length} images`);
        const space = spaceFor("media", batch.model);
        const written = inputs.map((i, k) => ({ mediaId: i.row.id, vector: batch.vectors[k] }));
        repo.upsertMany(batch.model, written);
        await index.upsert(space, written.map((w) => ({ id: w.mediaId, vector: w.vector })));
        for (const i of inputs) outcomes.set(i.row.id, { mediaId: i.row.id, status: "done" });
        // Stacks v2 uses these vectors - re-stack the affected folders.
        markFoldersDirty(db, inputs.map((i) => i.row.parent_folder_id));
      }
      return rows.map((r) => outcomes.get(r.id) as AnalyzerOutcome);
    },
  };
}
