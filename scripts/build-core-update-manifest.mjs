import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [artifactArg, url, outputArg] = process.argv.slice(2);
if (!artifactArg || !url || !outputArg) {
  console.error("Usage: node scripts/build-core-update-manifest.mjs <installer> <public-url> <output.json>");
  process.exit(1);
}
const privateKeyPath = process.env.MEMORYLANE_UPDATE_PRIVATE_KEY;
if (!privateKeyPath) throw new Error("MEMORYLANE_UPDATE_PRIVATE_KEY must point to an Ed25519 private PEM key");
const artifact = path.resolve(artifactArg);
const output = path.resolve(outputArg);
const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
const message = `${version}\n${url}\n${sha256}`;
const signature = crypto.sign(null, Buffer.from(message), fs.readFileSync(privateKeyPath)).toString("base64");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ version, url, sha256, signature }, null, 2) + "\n");
console.log(`Wrote signed core update manifest to ${output}`);
