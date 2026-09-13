// Assembles desktop/runtime/ - the exact folder layout server-manager.ts
// expects to find at runtime, in both dev (`npm run dev`) and packaged
// builds (electron-forge ships this via packagerConfig.extraResource - see
// forge.config.ts). Verified manually before this script existed: a copied
// node.exe running the server's own compiled dist/server.js works
// identically to a real Node install, with zero code changes - see the
// desktop-packaging investigation.
//
// Does a fresh production-only `npm install` into the runtime folder rather
// than copying the monorepo's root node_modules wholesale - that root tree
// carries every workspace's devDependencies too (vite, typescript, vitest,
// electron-forge itself, ...), which is both slow to copy (400+ packages)
// and wrong to ship. @memorylane/shared is a workspace-only package with no
// real npm registry entry, so it's assembled by hand alongside the install
// rather than fetched.
//
// Requires the root build to have already run (`npm run build` at the repo
// root) so server/dist, server/public, and shared/dist all exist.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.join(import.meta.dirname, "..", "..");
const runtimeDir = path.join(import.meta.dirname, "..", "runtime");

const serverDist = path.join(repoRoot, "server", "dist");
const serverPublic = path.join(repoRoot, "server", "public");
const sharedDist = path.join(repoRoot, "shared", "dist");
const serverPackageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "server", "package.json"), "utf8"));
const sharedPackageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "shared", "package.json"), "utf8"));

if (!fs.existsSync(serverDist) || !fs.existsSync(serverPublic) || !fs.existsSync(sharedDist)) {
  console.error('server/dist, server/public, or shared/dist not found - run "npm run build" at the repo root first.');
  process.exit(1);
}

fs.rmSync(runtimeDir, { recursive: true, force: true });
fs.mkdirSync(runtimeDir, { recursive: true });

console.log("Copying server/dist...");
fs.cpSync(serverDist, path.join(runtimeDir, "dist"), { recursive: true });

console.log("Copying server/public...");
fs.cpSync(serverPublic, path.join(runtimeDir, "public"), { recursive: true });

// A minimal package.json listing only the server's real production
// dependencies (excluding the workspace-only @memorylane/shared, handled
// below) - `npm install` here pulls just what's actually needed, not the
// whole monorepo's tooling.
const { "@memorylane/shared": _workspaceOnly, ...externalDeps } = serverPackageJson.dependencies;
fs.writeFileSync(
  path.join(runtimeDir, "package.json"),
  JSON.stringify({ name: "memorylane-runtime", private: true, type: "module", dependencies: externalDeps }, null, 2),
);

console.log("Installing production dependencies...");
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: runtimeDir, stdio: "inherit", shell: true });

console.log("Placing @memorylane/shared...");
const sharedTarget = path.join(runtimeDir, "node_modules", "@memorylane", "shared");
fs.mkdirSync(sharedTarget, { recursive: true });
fs.cpSync(sharedDist, path.join(sharedTarget, "dist"), { recursive: true });
fs.writeFileSync(
  path.join(sharedTarget, "package.json"),
  JSON.stringify({ name: "@memorylane/shared", version: sharedPackageJson.version, type: "module", main: "./dist/index.js" }, null, 2),
);

// A plain copy of the currently-running Node binary - no compilation, no
// bundling, just Node itself under a different name so end users never need
// their own Node install. See the desktop-packaging investigation for why
// this is simpler and more reliable than Node's SEA feature for this app.
const nodeBinName = process.platform === "win32" ? "node-runtime.exe" : "node-runtime";
console.log(`Copying node binary as ${nodeBinName}...`);
fs.copyFileSync(process.execPath, path.join(runtimeDir, nodeBinName));
if (process.platform !== "win32") {
  fs.chmodSync(path.join(runtimeDir, nodeBinName), 0o755);
}

console.log(`Runtime assembled at ${runtimeDir}`);
