import type { MediaType } from "@memorylane/shared";

// Standard, broadly-supported raster formats (section 8 of PLAN.md).
const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "bmp", "heic", "heif",
]);

// Camera RAW formats (section 6). Kept separate from IMAGE_EXTENSIONS because
// RAW files always go through the ExifTool embedded-preview pipeline, never
// a direct Sharp decode.
const RAW_EXTENSIONS = new Set([
  "cr2", "cr3", "craw", "nef", "arw", "raf", "dng",
]);

// Video is out of scope for the initial build (deprioritized per product
// direction - photos first). Extensions are recognized so files aren't
// silently mis-typed, but no thumbnail/metadata pipeline runs for them yet.
const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "m4v", "avi", "mkv", "webm",
]);

export const ALL_SUPPORTED_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...RAW_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
]);

export function classifyExtension(extensionNoDot: string): MediaType | null {
  const ext = extensionNoDot.toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (RAW_EXTENSIONS.has(ext)) return "raw";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}
