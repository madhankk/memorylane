import { build } from "esbuild";
import path from "node:path";

// Workspace dependencies are hoisted outside desktop/, which Forge copies.
// Bundle them so the installed app never depends on that external node_modules.
await build({
  absWorkingDir: path.resolve(import.meta.dirname, ".."),
  entryPoints: ["src/main.ts", "src/preload.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  external: ["electron"],
});
