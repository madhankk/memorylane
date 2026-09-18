import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

if (process.env.SIGN_RELEASE !== "1") throw new Error("SIGN_RELEASE=1 is required to sign plugin executables");
const root = path.resolve(import.meta.dirname, "..");
const plugins = path.join(root, "plugins");
const nativeRoots = [path.join(plugins, "required"), path.join(plugins, "optional", "com.memorylane.ai-runtime"), path.join(plugins, "optional", "com.memorylane.apple-photos")]
  .filter((directory) => fs.existsSync(directory));
const files = nativeRoots.flatMap((directory) => walk(directory));
if (process.platform === "win32") {
  const signer = path.join(root, "desktop", "scripts", "sign-app-windows.ps1");
  const targets = files.filter((file) => file.toLowerCase().endsWith(".exe"));
  if (!targets.length) throw new Error("No Windows plugin executables found");
  for (const target of targets) execFileSync("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", signer, target], { stdio: "inherit" });
} else if (process.platform === "darwin") {
  const identity = process.env.MACOS_SIGNING_IDENTITY;
  if (!identity) throw new Error("MACOS_SIGNING_IDENTITY is required");
  const targets = files.filter((file) => file.endsWith(".dylib") || file.endsWith(".node") || (fs.statSync(file).mode & 0o111) !== 0);
  if (!targets.length) throw new Error("No macOS plugin executables found");
  for (const target of targets) execFileSync("codesign", ["--force", "--options", "runtime", "--timestamp", "--sign", identity, target], { stdio: "inherit" });
} else throw new Error("Release plugin signing is supported only on Windows and macOS");
fs.writeFileSync(path.join(plugins, `.signed-${process.platform}-${process.arch}`), new Date().toISOString());

function walk(directory, out = []) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const item=path.join(directory,entry.name); if(entry.isDirectory()) walk(item,out); else out.push(item); } return out; }
