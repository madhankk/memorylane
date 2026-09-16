import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureHelperToken } from "./run-photos-helper.mjs";

test("creates one private per-install helper token and reuses it", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memorylane-helper-token-"));
  try {
    const first = ensureHelperToken(dataDir);
    const second = ensureHelperToken(dataDir);
    assert.equal(first, second);
    assert.ok(fs.readFileSync(first, "utf8").trim().length >= 32);
    assert.equal(fs.statSync(first).mode & 0o077, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
