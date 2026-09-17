import { expect, it } from "vitest";
import { createTestDb, seedFolder, seedMedia, seedScanRoot } from "../helpers/db.js";
import { createImportedTagAnalyzer } from "../../src/analysis/analyzers/import-tags.js";
import { TagRepo } from "../../src/tags/tag-repo.js";
import { AnalysisWorker } from "../../src/analysis/analysis-worker.js";
import type { Analyzer } from "../../src/analysis/types.js";
import { AnalysisRepo } from "../../src/analysis/analysis-repo.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as import("pino").Logger;

it("imports indexed EXIF keywords and updates them without losing a user tag", async () => {
  const db = await createTestDb();
  try {
    const root = seedScanRoot(db), folder = seedFolder(db, root, "/library"), media = seedMedia(db, folder, root);
    db.prepare("INSERT INTO media_exif (media_id, keywords_json, tags_json, exiftool_version) VALUES (?, ?, '{}', 'test')")
      .run(media, JSON.stringify(["River", "Travel"]));
    const repo = new TagRepo(db);
    repo.addUser(media, "favorite place");
    const analyzer = createImportedTagAnalyzer(db);
    const row = { id: media, parent_folder_id: folder, absolute_path: "/unused", media_type: "image" as const };
    await analyzer.run([row]);
    db.prepare("UPDATE media_exif SET keywords_json = ? WHERE media_id = ?").run(JSON.stringify(["Forest"]), media);
    await analyzer.run([row]);
    expect(repo.listForMedia(media).map((tag) => `${tag.name}:${tag.source}`))
      .toEqual(["favorite place:user", "forest:imported"]);
  } finally { db.close(); }
});

it("waits for current EXIF before claiming an imported-keyword job", async () => {
  const db = await createTestDb();
  try {
    const root = seedScanRoot(db), folder = seedFolder(db, root, "/library"), media = seedMedia(db, folder, root);
    db.prepare("INSERT INTO media_exif (media_id, keywords_json, tags_json, exiftool_version) VALUES (?, '[\"old\"]', '{}', 'test')").run(media);
    db.prepare("INSERT INTO media_analysis (media_id, analyzer, status) VALUES (?, 'import_tags', 'pending')").run(media);
    const repo = new AnalysisRepo(db), imported = createImportedTagAnalyzer(db);
    expect(repo.claimBatch(imported)).toEqual([]);
    repo.markDone(media, "exif_full", "v1");
    expect(repo.claimBatch(imported).map((row) => row.id)).toEqual([media]);
  } finally { db.close(); }
});

it("refreshes a completed imported tag when EXIF is recomputed", async () => {
  const db = await createTestDb();
  try {
    const root = seedScanRoot(db), folder = seedFolder(db, root, "/library"), media = seedMedia(db, folder, root);
    db.prepare("INSERT INTO media_exif (media_id, keywords_json, tags_json, exiftool_version) VALUES (?, '[\"old\"]', '{}', 'test')").run(media);
    const imported = createImportedTagAnalyzer(db);
    const repo = new TagRepo(db);
    await imported.run([{ id: media, parent_folder_id: folder, absolute_path: "/unused", media_type: "image" }]);
    db.prepare("INSERT INTO media_analysis (media_id, analyzer, status, model_version) VALUES (?, 'import_tags', 'done', 'keywords-v1')").run(media);
    db.prepare("INSERT INTO media_analysis (media_id, analyzer, status) VALUES (?, 'exif_full', 'pending')").run(media);
    const exif: Analyzer = { key: "exif_full", version: "v2", batchSize: 1, appliesTo: "1=1", run: async (rows) => {
      db.prepare("UPDATE media_exif SET keywords_json = '[\"new\"]' WHERE media_id = ?").run(media);
      return rows.map((row) => ({ mediaId: row.id, status: "done" as const }));
    } };
    const worker = new AnalysisWorker(db, logger, [exif, imported], () => false);
    await worker.runOnce();
    expect(repo.listForMedia(media).map((tag) => tag.name)).toEqual(["new"]);
  } finally { db.close(); }
});
