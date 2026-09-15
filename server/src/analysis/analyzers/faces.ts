import type Database from "better-sqlite3";
import type { AppPaths } from "../../config/paths.js";
import { ProviderUnavailableError, type AiProvider } from "../../providers/types.js";
import { renderAnalysisJpeg } from "../../media/analysis-input.js";
import { FaceRepo } from "../../persons/face-repo.js";
import { spaceFor, type VectorIndex } from "../../vectors/vector-index.js";
import type { Analyzer, AnalysisMediaRow, AnalyzerOutcome } from "../types.js";

export const FACES_KEY = "faces";

// Detects faces on a 1600px render of each still, stores rows + vectors in
// the faces:<model> space, then hands new face ids to PersonService for
// incremental assignment. Disabled until People is switched on.
export function createFacesAnalyzer(
  db: Database.Database,
  paths: AppPaths,
  provider: AiProvider,
  index: VectorIndex,
  isEnabled: () => boolean,
  onNewFaces: (faceIds: number[]) => Promise<void>,
): Analyzer {
  const repo = new FaceRepo(db);
  return {
    key: FACES_KEY,
    version: provider.expectedFaceModel,
    batchSize: 8,
    appliesTo: "media_type IN ('image', 'raw') AND thumbnail_status = 'done'",
    isEnabled,
    async run(rows: AnalysisMediaRow[]): Promise<AnalyzerOutcome[]> {
      const health = await provider.health();
      if (!health.reachable) throw new ProviderUnavailableError(health.lastError ?? "Sidecar not reachable");
      if (health.faceModel !== provider.expectedFaceModel) {
        throw new ProviderUnavailableError(`Sidecar face model ${health.faceModel ?? "none"} does not match configured ${provider.expectedFaceModel}`);
      }

      const outcomes = new Map<number, AnalyzerOutcome>();
      const inputs: { row: AnalysisMediaRow; jpeg: Buffer }[] = [];
      for (const row of rows) {
        const jpeg = await renderAnalysisJpeg(paths, row);
        if (!jpeg) outcomes.set(row.id, { mediaId: row.id, status: "unsupported", error: "No analysable image" });
        else inputs.push({ row, jpeg });
      }

      if (inputs.length > 0) {
        const batch = await provider.detectFaces(inputs.map((i) => i.jpeg));
        if (batch.images.length !== inputs.length) throw new Error(`Sidecar returned ${batch.images.length} results for ${inputs.length} images`);
        const space = spaceFor("faces", batch.model);
        const newIds: number[] = [];
        const upserts: { id: number; vector: Float32Array }[] = [];
        const removals: number[] = [];
        inputs.forEach((input, k) => {
          const dets = batch.images[k];
          const { ids, removed } = repo.replaceForMedia(input.row.id, batch.model, dets);
          removals.push(...removed);
          ids.forEach((id, j) => upserts.push({ id, vector: dets[j].embedding }));
          newIds.push(...ids);
          outcomes.set(input.row.id, { mediaId: input.row.id, status: "done" });
        });
        await index.remove(space, removals);
        await index.upsert(space, upserts);
        await onNewFaces(newIds);
      }
      return rows.map((r) => outcomes.get(r.id) as AnalyzerOutcome);
    },
  };
}
