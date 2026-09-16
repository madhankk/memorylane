import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectPhotosLibraries } from "../../src/plugins/apple-photos/detect.js";

describe("Photos library detection", () => {
  it("finds packages in Pictures and reports an unreadable catalogue as a setup issue", () => {
    const pictures = fs.mkdtempSync(path.join(os.tmpdir(), "memorylane-pictures-"));
    const ready = path.join(pictures, "Ready.photoslibrary");
    const unavailable = path.join(pictures, "Unreadable.photoslibrary");
    fs.mkdirSync(path.join(ready, "database"), { recursive: true });
    fs.writeFileSync(path.join(ready, "database", "Photos.sqlite"), "fixture");
    fs.mkdirSync(unavailable);
    try {
      expect(detectPhotosLibraries(pictures)).toEqual([
        { path: ready, readable: true },
        { path: unavailable, readable: false, reason: "Photos catalogue is not accessible" },
      ]);
    } finally {
      fs.rmSync(pictures, { recursive: true, force: true });
    }
  });
});
