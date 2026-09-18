import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "server", "src");
const rules = new Map([
  ["exiftool-vendored", new Set()],
  ["ffmpeg-static", new Set()],
  ["ffprobe-static", new Set()],
  ["@lancedb/lancedb", new Set()],
]);

const violations = [];
for (const file of walk(source).filter((file) => !file.endsWith(".d.ts"))) {
  const relative = path.relative(source, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");
  for (const [dependency, allowed] of rules) {
    const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:from\\s+|import\\s*\\()?["']${escaped}(?:/[^"']*)?["']`).test(text) && !allowed.has(relative)) {
      violations.push(`${relative}: direct import of ${dependency}`);
    }
  }
}

if (violations.length) {
  console.error("Feature-specific native dependencies crossed the core boundary:\n" + violations.map((v) => `  ${v}`).join("\n"));
  process.exit(1);
}
console.log(`Core plugin dependency boundaries verified (${rules.size} native packages).`);

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(item, files); else if (entry.name.endsWith(".ts")) files.push(item);
  }
  return files;
}
