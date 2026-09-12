import { ExifTool, type Tags } from "exiftool-vendored";
import type { Logger } from "pino";

// exiftool-vendored keeps a small pool of long-lived exiftool processes rather
// than spawning one per file - this is the main reason RAW metadata extraction
// stays fast across a large library. One instance is shared for the app lifetime.
let sharedInstance: ExifTool | null = null;
let availabilityChecked = false;
let isAvailable = false;

export function getExifTool(): ExifTool {
  if (!sharedInstance) {
    sharedInstance = new ExifTool({ maxProcs: 2 });
  }
  return sharedInstance;
}

export async function checkExifToolAvailable(logger: Logger): Promise<boolean> {
  if (availabilityChecked) return isAvailable;
  try {
    const et = getExifTool();
    await et.version();
    isAvailable = true;
    logger.info("ExifTool is available");
  } catch (err) {
    isAvailable = false;
    logger.warn({ err }, "ExifTool is not available - RAW metadata/preview extraction will be degraded");
  }
  availabilityChecked = true;
  return isAvailable;
}

export function isExifToolAvailable(): boolean {
  return isAvailable;
}

export async function readTags(filePath: string): Promise<Tags | null> {
  if (!isAvailable) return null;
  try {
    return await getExifTool().read(filePath);
  } catch {
    return null;
  }
}

// Returns the largest embedded preview image found in a RAW file, if any.
// Tries the tags in rough order of typical size (largest-first) across
// common camera makes; the first one that resolves to actual bytes wins.
export async function extractLargestEmbeddedPreview(filePath: string): Promise<Buffer | null> {
  if (!isAvailable) return null;
  const et = getExifTool();
  const candidateTags = ["JpgFromRaw2", "JpgFromRaw", "PreviewImage", "OtherImage", "ThumbnailImage"];

  for (const tag of candidateTags) {
    try {
      const buf = await et.extractBinaryTagToBuffer(tag, filePath);
      if (buf && buf.length > 0) return buf;
    } catch {
      // tag not present on this file - try the next candidate
    }
  }
  return null;
}

export async function shutdownExifTool(): Promise<void> {
  if (sharedInstance) {
    await sharedInstance.end();
    sharedInstance = null;
  }
}
