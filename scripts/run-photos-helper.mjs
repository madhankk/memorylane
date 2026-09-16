import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function appDataDir() {
  if (process.env.MEMORYLANE_DATA_DIR) return path.resolve(process.env.MEMORYLANE_DATA_DIR);
  const defaultDir = path.join(os.homedir(), "Library", "Application Support", "MemoryLane");
  try {
    const moved = fs.readFileSync(path.join(defaultDir, "data-location.txt"), "utf8").trim();
    if (moved && fs.statSync(moved).isDirectory()) return moved;
  } catch {
    // No Storage move pointer exists.
  }
  return defaultDir;
}

export function ensureHelperToken(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tokenFile = path.join(dataDir, "photos-helper-token");
  try {
    const fd = fs.openSync(tokenFile, "wx", 0o600);
    try {
      fs.writeFileSync(fd, randomBytes(32).toString("hex") + "\n");
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  fs.chmodSync(tokenFile, 0o600);
  return tokenFile;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function main() {
  if (process.platform !== "darwin") throw new Error("Apple Photos helper is available only on macOS");
  const dataDir = appDataDir();
  const tokenFile = ensureHelperToken(dataDir);
  const venv = path.join(dataDir, "photos-helper-venv");
  const python = path.join(venv, "bin", "python");
  if (!fs.existsSync(python)) {
    run("python3", ["-m", "venv", venv]);
    run(python, ["-m", "pip", "install", "-r", path.join(projectRoot, "photos-helper", "requirements.txt")]);
  }
  const child = spawn(python, ["-m", "memorylane_photos.server", "--token-file", tokenFile], {
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: path.join(projectRoot, "photos-helper") },
  });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
