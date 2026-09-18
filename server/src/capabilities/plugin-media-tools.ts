import type { VideoTranscodeQuality } from "@memorylane/shared";
import type { PluginManager } from "../plugin-platform/manager.js";
import { CapabilityUnavailableError } from "./errors.js";
import type { MediaToolCapabilities, MetadataTags, VideoProbe } from "./media-tools.js";

const METADATA = "com.memorylane.metadata-raw";
const VIDEO = "com.memorylane.video-tools";

export class PluginMediaToolCapabilities implements MediaToolCapabilities {
  private metadataToolVersion = "unavailable";
  constructor(private manager: PluginManager) {}

  metadata = {
    available: () => !!this.manager.supervisor.get(METADATA),
    read: async (sourcePath: string): Promise<MetadataTags | null> => {
      const result = await this.call<{ tags: MetadataTags | null; toolVersion: string }>(METADATA, "/metadata", { sourcePath });
      this.metadataToolVersion = result.toolVersion;
      return result.tags;
    },
    version: () => this.metadataToolVersion,
  };
  rawPreview = {
    extract: async (sourcePath: string): Promise<Buffer | null> => {
      const result = await this.call<{ data: string | null }>(METADATA, "/raw-preview", { sourcePath });
      return result.data ? Buffer.from(result.data, "base64") : null;
    },
  };
  video = {
    available: () => !!this.manager.supervisor.get(VIDEO),
    probe: (sourcePath: string): Promise<VideoProbe | null> => this.call<VideoProbe>(VIDEO, "/probe", { sourcePath }),
    poster: async (sourcePath: string): Promise<Buffer | null> => {
      const result = await this.call<{ data: string | null }>(VIDEO, "/poster", { sourcePath });
      return result.data ? Buffer.from(result.data, "base64") : null;
    },
    transcode: async (sourcePath: string, destinationPath: string, quality: VideoTranscodeQuality): Promise<boolean> => {
      await this.call(VIDEO, "/transcode", { sourcePath, destinationPath, quality }); return true;
    },
  };

  private async call<T>(pluginId: string, endpoint: string, body: unknown): Promise<T> {
    const instance = this.manager.supervisor.get(pluginId);
    if (!instance) throw new CapabilityUnavailableError(pluginId);
    try {
      const response = await fetch(`http://127.0.0.1:${instance.port}${endpoint}`, {
        method: "POST", headers: { authorization: `Bearer ${instance.token}`, "content-type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
      });
      const result = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      return result;
    } catch (error) {
      if (!this.manager.supervisor.get(pluginId)) throw new CapabilityUnavailableError(pluginId);
      throw error;
    }
  }
}
