import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const output = path.resolve(process.argv[2] ?? ".keys/core-update-private.pem");
if (fs.existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
const rawPublicKey = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64");
console.log(`Private key: ${output}`);
console.log(`MEMORYLANE_UPDATE_PUBLIC_KEY=${rawPublicKey}`);
