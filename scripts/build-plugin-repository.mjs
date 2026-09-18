import fs from "node:fs";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import yazl from "yazl";
import { PluginCatalogSchema, PluginManifestSchema, PLUGIN_PLATFORMS } from "../plugin-sdk/dist/index.js";

const root = path.resolve(import.meta.dirname, "..");
const defaultReleasePlatforms = ["win32-x64", "darwin-x64", "darwin-arm64"];
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const assigned = args.find((item) => item.startsWith(`${flag}=`));
  if (assigned) return assigned.slice(flag.length + 1);
  const i = args.indexOf(flag); return i < 0 ? null : args[i + 1];
};
const channel = valueAfter("--channel") ?? args.find((item) => item === "stable" || item === "beta") ?? "stable";
if (!new Set(["stable", "beta"]).has(channel)) throw new Error("--channel must be stable or beta");
const flaggedPlatforms = valueAfter("--platforms");
const positionalPlatforms = args
  .flatMap((item) => item.split(","))
  .filter((item) => PLUGIN_PLATFORMS.includes(item));
const platforms = flaggedPlatforms
  ? flaggedPlatforms.split(",")
  : positionalPlatforms.length > 0
    ? positionalPlatforms
    : defaultReleasePlatforms;
for (const platform of platforms) if (!PLUGIN_PLATFORMS.includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
const outputDir = path.resolve(root, valueAfter("--output") ?? `dist/plugin-repository/v1/${channel}`);
const sourceRoot = path.resolve(root, valueAfter("--source") ?? "plugins");
const development = args.includes("--development") || valueAfter("--development") === "true" || args.includes("development");
if (!development && process.env.SIGN_RELEASE === "1" && !fs.existsSync(path.join(root, "plugins", `.signed-${process.platform}-${process.arch}`))) {
  throw new Error("Native plugin executables must be signed before a release repository build");
}
if (!outputDir.startsWith(root + path.sep) || outputDir === root) throw new Error("Plugin repository output must stay inside the workspace");
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

// Same default-location pattern as tray-go/scripts/prepare-runtime.mjs's
// bundled-required-plugins step: MEMORYLANE_PLUGIN_SIGNING_KEY always wins if
// set, otherwise fall back to the real key at its default repo location
// before finally requiring --development's throwaway keypair.
const defaultSigningKeyPath = path.join(root, ".keys", "plugin-release-private.pem");

function readSigningKey() {
  const configured = process.env.MEMORYLANE_PLUGIN_SIGNING_KEY;
  if (configured) return configured.includes("BEGIN PRIVATE KEY") ? configured : fs.readFileSync(configured, "utf8");
  if (fs.existsSync(defaultSigningKeyPath)) return fs.readFileSync(defaultSigningKeyPath, "utf8");
  if (!development) throw new Error(`MEMORYLANE_PLUGIN_SIGNING_KEY is required outside --development builds (no key found at ${defaultSigningKeyPath} either)`);
  const pair = generateKeyPairSync("ed25519");
  fs.writeFileSync(path.join(outputDir, "development-public-key.pem"), pair.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  return pair.privateKey;
}

const privateKey = readSigningKey();
const releases = [];
for (const pluginRoot of findPluginRoots(sourceRoot)) {
  const rawTemplate = JSON.parse(fs.readFileSync(path.join(pluginRoot, "manifest.template.json"), "utf8"));
  const { buildPlatforms = PLUGIN_PLATFORMS, ...template } = rawTemplate;
  for (const platform of platforms) {
    const allowedPlatforms = buildPlatforms.includes("host") ? [`${process.platform}-${process.arch}`] : buildPlatforms;
    if (!allowedPlatforms.includes(platform)) continue;
    const manifest = PluginManifestSchema.parse({ ...template, platform });
    const packageFiles = listFiles(pluginRoot).filter((file) => {
      const relative = path.relative(pluginRoot, file).replaceAll("\\", "/");
      return path.basename(file) !== "manifest.template.json" && !path.basename(file).startsWith(".signed-") && !relative.startsWith("src/") && !relative.startsWith("python/");
    });
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const installedSize = manifestBytes.length + packageFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
    const artifactRelative = `artifacts/${manifest.id}/${manifest.version}/${platform}.mlplugin`;
    const artifactPath = path.join(outputDir, ...artifactRelative.split("/"));
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    await writeZip(artifactPath, [{ name: "manifest.json", bytes: manifestBytes }, ...packageFiles.map((file) => ({
      name: path.relative(pluginRoot, file).replaceAll("\\", "/"), file,
    }))]);
    const artifactBytes = fs.readFileSync(artifactPath);
    const digest = sha256(artifactBytes);
    releases.push({
      manifest,
      artifact: {
        url: artifactRelative,
        size: artifactBytes.length,
        installedSize,
        sha256: digest,
        signature: sign(null, Buffer.from(digest, "hex"), privateKey).toString("base64"),
      },
      releaseNotes: "Repository lifecycle fixture.",
      mandatory: false,
    });
  }
}

const catalog = PluginCatalogSchema.parse({ formatVersion: 1, channel, generatedAt: new Date().toISOString(), revoked: [], releases });
const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "catalog.json"), catalogBytes);
fs.writeFileSync(path.join(outputDir, "catalog.json.sig"), `${sign(null, catalogBytes, privateKey).toString("base64")}\n`);
const published = listFiles(outputDir).filter((file) => path.basename(file) !== "release-manifest.json").map((file) => ({
  path: path.relative(outputDir, file).replaceAll("\\", "/"), bytes: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)),
}));
fs.writeFileSync(path.join(outputDir, "release-manifest.json"), `${JSON.stringify({ formatVersion: 1, channel, files: published }, null, 2)}\n`);
console.log(`Built ${releases.length} plugin artifact(s) in ${path.relative(root, outputDir)}`);

function listFiles(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(item, result); else result.push(item);
  }
  return result.sort();
}

// `plugins/fixtures/` holds dev/test-only plugins (e.g. com.memorylane.fixture-module,
// used to exercise the plugin platform's own install/release machinery) - they
// have no business showing up as a real feature to an end user, so a real
// (non-development) catalog build skips that directory entirely. Only checked
// at the top level, so a plugin that happens to have its own subfolder named
// "fixtures" for unrelated reasons is unaffected.
function findPluginRoots(directory, result = [], includeFixtures = development, isRoot = true) {
  if (fs.existsSync(path.join(directory, "manifest.template.json"))) result.push(directory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    if (isRoot && entry.name === "fixtures" && !includeFixtures) continue;
    findPluginRoots(path.join(directory, entry.name), result, includeFixtures, false);
  }
  return result.sort();
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function writeZip(destination, entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const output = fs.createWriteStream(destination, { flags: "wx" });
    output.once("error", reject); output.once("close", resolve); zip.outputStream.once("error", reject).pipe(output);
    const mtime = new Date("2000-01-01T00:00:00.000Z");
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.file) zip.addFile(entry.file, entry.name, { mtime, mode: fs.statSync(entry.file).mode });
      else zip.addBuffer(entry.bytes, entry.name, { mtime, mode: 0o100644 });
    }
    zip.end();
  });
}
