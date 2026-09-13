// Rebuild all icon formats from the generated master; preserves transparency.
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

const assets = path.resolve(import.meta.dirname, "../assets");
const publicDir = path.resolve(import.meta.dirname, "../../client/public");
await fs.mkdir(publicDir, { recursive: true });
const source = path.join(assets, "icon-source.png");
const pngs = new Map();
for (const size of [16, 32, 48, 64, 128, 180, 256, 512, 1024]) {
  pngs.set(size, await sharp(source).resize(size, size).png().toBuffer());
}
for (const size of [16, 32, 256]) {
  await fs.writeFile(path.join(assets, `icon-${size}.png`), pngs.get(size));
}
await fs.writeFile(path.join(assets, "icon.png"), pngs.get(1024));

// ICO directory with PNG-encoded entries, supported by modern Windows.
const sizes = [16, 32, 48, 64, 128, 256];
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(pngs.get(size).length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += pngs.get(size).length;
});
const ico = Buffer.concat([directory, ...sizes.map(size => pngs.get(size))]);
await fs.writeFile(path.join(assets, "icon.ico"), ico);

// Modern macOS ICNS chunks contain PNG representations.
const chunks = [["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128],
  ["ic08", 256], ["ic09", 512], ["ic10", 1024]].map(([type, size]) => {
  const header = Buffer.alloc(8);
  header.write(type);
  header.writeUInt32BE(8 + pngs.get(size).length, 4);
  return Buffer.concat([header, pngs.get(size)]);
});
const header = Buffer.alloc(8);
header.write("icns");
header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
await fs.writeFile(path.join(assets, "icon.icns"), Buffer.concat([header, ...chunks]));
await fs.writeFile(path.join(publicDir, "favicon.ico"), ico);
await fs.writeFile(path.join(publicDir, "icon-32.png"), pngs.get(32));
await fs.writeFile(path.join(publicDir, "apple-touch-icon.png"), pngs.get(180));
// Electron loads the @2x sibling for Retina displays. Template images use
// black artwork and transparency; macOS supplies the menu-bar foreground color.
for (const scale of [1, 2]) {
  await sharp(path.join(assets, "tray-template.svg"), { density: 72 * scale })
    .resize(18 * scale, 18 * scale)
    .png()
    .toFile(path.join(assets, `trayTemplate${scale === 2 ? "@2x" : ""}.png`));
}
console.log("Updated desktop icons and browser icons from icon-source.png");
