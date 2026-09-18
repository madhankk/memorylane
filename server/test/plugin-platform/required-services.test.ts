import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PluginManifestSchema } from "@memorylane/plugin-sdk";
import { PluginServiceSupervisor } from "../../src/plugin-platform/service-supervisor.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("required first-party plugin services", () => {
  for (const pluginId of ["com.memorylane.metadata-raw", "com.memorylane.video-tools"]) {
    it(`starts and authenticates ${pluginId}`, async () => {
      const pluginDir = path.join(repositoryRoot, "plugins", "required", pluginId);
      const { buildPlatforms: _buildPlatforms, ...template } = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.template.json"), "utf8"));
      const manifest = PluginManifestSchema.parse({ ...template, platform: `${process.platform}-${process.arch}` });
      const supervisor = new PluginServiceSupervisor({ coreVersion: "0.2.0", dataDirFor: () => pluginDir, logDirFor: () => pluginDir });
      try {
        const instance = await supervisor.start(manifest, pluginDir);
        expect((await fetch(`http://127.0.0.1:${instance.port}/health`)).status).toBe(401);
        const health = await fetch(`http://127.0.0.1:${instance.port}/health`, { headers: { authorization: `Bearer ${instance.token}` } });
        expect(await health.json()).toMatchObject({ status: "ready", pluginId, version: "1.0.0", pluginApi: 1 });
      } finally { await supervisor.stopAll(); }
    }, 30_000);
  }
});
