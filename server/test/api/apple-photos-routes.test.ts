import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createTestApp } from "../helpers/app.js";

describe("Apple Photos sync routes", () => {
  afterEach(() => { delete process.env.MEMORYLANE_PHOTOS_HELPER_PORT; });

  it("keeps sync unavailable while disabled and imports a helper batch when enabled", async () => {
    const t = await createTestApp();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "memorylane-apple-route-"));
    const library = path.join(scratch, "Test.photoslibrary");
    fs.mkdirSync(library);
    const token = "test-helper-token";
    fs.writeFileSync(path.join(t.ctx.paths.dataDir, "photos-helper-token"), token, { mode: 0o600 });
    const helper = http.createServer((req, res) => {
      if (req.headers["x-memorylane-token"] !== token) { res.writeHead(401).end(); return; }
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/health") { res.end(JSON.stringify({ status: "ready" })); return; }
      res.end(JSON.stringify({ assets: [{ uuid: "cloud-1", original_filename: "Cloud.jpg", original_path: null,
        derivative_path: null, original_available: false, date: "2020-08-10T12:00:00", title: null, description: null,
        keywords: [], favorite: false, hidden: false, in_trash: false, latitude: 12, longitude: 34, faces: [] }],
        next_cursor: null, total: 1 }));
    });
    await new Promise<void>((resolve) => helper.listen(0, "127.0.0.1", resolve));
    process.env.MEMORYLANE_PHOTOS_HELPER_PORT = String((helper.address() as { port: number }).port);
    try {
      const call = (method: "GET" | "PUT" | "POST", url: string, payload?: unknown) =>
        t.app.inject({ method, url, headers: { cookie: t.cookie }, payload });
      const rootId = Number(t.db.prepare("INSERT INTO scan_roots (path, enabled, kind) VALUES (?, 1, 'apple-photos')").run(library).lastInsertRowid);
      expect((await call("POST", `/api/plugins/apple-photos/roots/${rootId}/sync`)).statusCode).toBe(409);
      expect((await call("GET", `/api/plugins/apple-photos/roots/${rootId}/browse`)).statusCode).toBe(404);
      expect((await call("GET", "/api/plugins/apple-photos/health")).statusCode).toBe(409);
      await call("PUT", "/api/plugins/apple-photos", { enabled: true });
      expect((await call("GET", "/api/plugins/apple-photos/health")).json()).toMatchObject({ status: "ready" });
      expect((await call("POST", `/api/plugins/apple-photos/roots/${rootId}/sync`)).statusCode).toBe(202);
      for (let i = 0; i < 50; i++) {
        const status = (await call("GET", `/api/plugins/apple-photos/roots/${rootId}/sync`)).json();
        if (status.status === "completed") {
          expect(status).toMatchObject({ processed: 1, total: 1 });
          expect(t.db.prepare("SELECT uuid FROM apple_photos_assets WHERE scan_root_id = ?").get(rootId)).toEqual({ uuid: "cloud-1" });
          const years = (await call("GET", `/api/plugins/apple-photos/roots/${rootId}/browse`)).json();
          expect(years.groups).toMatchObject([{ key: "2020", count: 1 }]);
          const month = (await call("GET", `/api/plugins/apple-photos/roots/${rootId}/browse?year=2020&month=08`)).json();
          expect(month.items).toMatchObject([{ uuid: "cloud-1", available: false, latitude: 12, longitude: 34 }]);
          const checked = await call("POST", `/api/plugins/apple-photos/roots/${rootId}/items/check-local`, { uuid: "cloud-1" });
          expect(checked.statusCode).toBe(200);
          expect(checked.json()).toEqual({ available: false });
          expect(t.db.prepare("SELECT status, processed, total FROM apple_photos_sync_state WHERE scan_root_id = ?").get(rootId))
            .toEqual({ status: "completed", processed: 1, total: 1 });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Sync did not complete");
    } finally {
      await t.close();
      await new Promise<void>((resolve) => helper.close(() => resolve()));
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});
