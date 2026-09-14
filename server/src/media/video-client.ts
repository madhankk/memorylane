import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import type { Logger } from "pino";

const execFileAsync = promisify(execFile);

let availabilityChecked = false;
let isAvailable = false;

// Thumbnail extraction only - no transcoding for playback. Originals are
// served as-is (see file-streaming.ts's Range support); if a browser can't
// decode a given container/codec, it simply won't play, the same way an
// unsupported RAW format would fail to open in any other viewer. Building a
// compatibility-transcode layer is a much bigger, ongoing-maintenance-cost
// feature that isn't in scope here.
export async function checkFfmpegAvailable(logger: Logger): Promise<boolean> {
  if (availabilityChecked) return isAvailable;
  try {
    if (!ffmpegPath || !ffprobeStatic.path) throw new Error("ffmpeg-static/ffprobe-static did not resolve a binary path");
    await execFileAsync(ffmpegPath, ["-version"]);
    await execFileAsync(ffprobeStatic.path, ["-version"]);
    isAvailable = true;
    logger.info("ffmpeg/ffprobe are available");
  } catch (err) {
    isAvailable = false;
    logger.warn({ err }, "ffmpeg/ffprobe are not available - video thumbnails/duration will be degraded");
  }
  availabilityChecked = true;
  return isAvailable;
}

export function isFfmpegAvailable(): boolean {
  return isAvailable;
}

export interface VideoProbeResult {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
}

export async function probeVideo(filePath: string): Promise<VideoProbeResult | null> {
  if (!isAvailable) return null;
  try {
    const { stdout } = await execFileAsync(ffprobeStatic.path, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,codec_name:format=duration",
      "-of", "json",
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number; codec_name?: string }[];
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    const duration = parsed.format?.duration ? Number(parsed.format.duration) : null;
    return {
      durationSeconds: duration !== null && Number.isFinite(duration) ? duration : null,
      width: stream?.width ?? null,
      height: stream?.height ?? null,
      codec: stream?.codec_name ?? null,
    };
  } catch {
    return null;
  }
}

// A single representative frame as a JPEG buffer, for the existing Sharp
// thumbnail pipeline (generateThumbnailFromBuffer) to resize exactly like
// any other buffer-sourced thumbnail (RAW previews, this). 0.5s in is safely
// within even a ~3s Live Photo clip while skipping the very first frame,
// which is disproportionately likely to be black/blank on real footage.
export async function extractPosterFrame(filePath: string): Promise<Buffer | null> {
  if (!isAvailable) return null;
  try {
    const { stdout } = await execFileAsync(
      ffmpegPath!,
      ["-ss", "0.5", "-i", filePath, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
      { encoding: "buffer", maxBuffer: 1024 * 1024 * 64 },
    );
    return stdout.length > 0 ? stdout : null;
  } catch {
    // Some very short clips have nothing at 0.5s - retry at the very start
    // before giving up (a missing thumbnail beats a failed scan either way).
    try {
      const { stdout } = await execFileAsync(
        ffmpegPath!,
        ["-i", filePath, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
        { encoding: "buffer", maxBuffer: 1024 * 1024 * 64 },
      );
      return stdout.length > 0 ? stdout : null;
    } catch {
      return null;
    }
  }
}
