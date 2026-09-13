// One-off placeholder icon generator - real branded icons should replace
// these before shipping. Produces a simple solid-color rounded square so the
// tray/app has *something* rather than a broken icon reference during dev.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const assetsDir = path.join(import.meta.dirname, "..", "assets");
fs.mkdirSync(assetsDir, { recursive: true });

const svg = (size) => `
  <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#2f6fed"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.28}" fill="#ffffff"/>
  </svg>
`;

const sizes = [16, 32, 256];
for (const size of sizes) {
  await sharp(Buffer.from(svg(size))).png().toFile(path.join(assetsDir, `icon-${size}.png`));
}
// electron-packager's Windows icon option wants a real .ico - without a real
// ICO encoder here, ship the 256px PNG under that name as a stand-in;
// packaging will warn but still build. Replace before release.
fs.copyFileSync(path.join(assetsDir, "icon-256.png"), path.join(assetsDir, "icon.png"));

console.log("Placeholder icons written to desktop/assets/");
