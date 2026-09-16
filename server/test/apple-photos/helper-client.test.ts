import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchCatalogPage } from "../../src/plugins/apple-photos/helper-client.js";

describe("Apple Photos helper request errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("distinguishes a timed-out catalog load from a stopped helper", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photos-helper-client-"));
    fs.writeFileSync(path.join(dataDir, "photos-helper-token"), "test-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("request timed out"), { name: "TimeoutError" })));
    try {
      await expect(fetchCatalogPage(dataDir, "/Pictures/Test.photoslibrary", 0))
        .rejects.toThrow(/Photos catalog.*timed out/i);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
