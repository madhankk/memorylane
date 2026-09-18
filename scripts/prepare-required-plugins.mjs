import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
for (const id of ["com.memorylane.metadata-raw", "com.memorylane.video-tools"]) {
  const directory = path.join(root, "plugins", "required", id);
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: directory, stdio: "inherit", shell: process.platform === "win32" });
}

const probeBin = path.join(root, "plugins", "required", "com.memorylane.video-tools", "node_modules", "ffprobe-static", "bin");
const keep = path.join(probeBin, process.platform, process.arch);
if (!fs.existsSync(keep)) throw new Error(`ffprobe-static has no binary for ${process.platform}/${process.arch}`);
for (const platform of fs.readdirSync(probeBin, { withFileTypes: true })) {
  if (!platform.isDirectory()) continue;
  const platformPath = path.join(probeBin, platform.name);
  if (platform.name !== process.platform) fs.rmSync(platformPath, { recursive: true, force: true });
  else for (const arch of fs.readdirSync(platformPath, { withFileTypes: true })) {
    if (arch.isDirectory() && arch.name !== process.arch) fs.rmSync(path.join(platformPath, arch.name), { recursive: true, force: true });
  }
}
console.log(`Prepared required plugins for ${process.platform}-${process.arch}`);
