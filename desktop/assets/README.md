# MemoryLane icon

The photo frame represents the personal archive; the winding lane and warm sun represent rediscovering memories. Blue and ivory echo the app's accent and paper colors.

`icon-source.png` is the original artwork created with the built-in image generation tool. Rebuild desktop PNG, Windows ICO, macOS ICNS, and browser assets with `node desktop/scripts/gen-icons.mjs` from the repository root. No API call is needed to rebuild.

## Generation prompt

The macOS menu bar uses `trayTemplate.png` (18px) and `trayTemplate@2x.png` (36px Retina). These transparent black template images are rendered from the editable `tray-template.svg`, a simplified photo-frame, sun, and lane mark. Electron marks them as template images so macOS controls their color. The same rebuild command generates both sizes.

Use case: logo-brand. Create one polished square app icon for MemoryLane, a local personal photo archive browser focused on rediscovering old memories. A bold ivory photographic print frame containing a simple winding ivory lane receding through blue hills toward a warm amber sun. Deep blue rounded-square tile, subtle tonal depth, warm nostalgic but modern and minimal. Existing app palette blue #2f6fed and warm paper #f7f4ee. Large centered recognizable silhouette, thick shapes legible at 16 and 32 pixels, generous safe margin. Front-facing flat graphic, restrained subtle depth, no tiny details. Transparent exterior outside rounded tile. No text, letters, watermark, mockup, or additional icons. Output a single 1024x1024 icon.
