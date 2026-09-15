import { ProviderUnavailableError, type EmbeddingBatch, type EmbeddingProvider, type ProviderInfo } from "./types.js";

interface SidecarHealth {
  ok: boolean;
  device: string;
  models: { image_embed: { id: string; dim: number }; text_embed: { id: string; dim: number } };
}

interface SidecarVectors {
  model: string;
  dim: number;
  vectors: number[][];
}

export interface SidecarProviderOptions {
  token?: string;
  expectedModel: string;
  healthTtlMs?: number;
  requestTimeoutMs?: number;
}

// HTTP client for memorylane-ai (design doc §6.5). Health is cached briefly
// so the analyzer's per-batch check is free; every failure classification
// matters: outages -> ProviderUnavailableError (back off), 4xx -> Error (the
// batch is bad, mark it failed).
export class SidecarProvider implements EmbeddingProvider {
  readonly id = "sidecar";
  readonly expectedModel: string;
  private info: ProviderInfo;
  private healthTtlMs: number;
  private requestTimeoutMs: number;
  private token: string | undefined;

  constructor(
    private url: string,
    opts: SidecarProviderOptions,
  ) {
    this.expectedModel = opts.expectedModel;
    this.token = opts.token;
    this.healthTtlMs = opts.healthTtlMs ?? 30_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 60_000;
    this.info = { url, reachable: false, model: null, dim: null, device: null, lastError: null, checkedAt: null };
  }

  getInfo(): ProviderInfo {
    return { ...this.info };
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token ? { ...extra, Authorization: `Bearer ${this.token}` } : extra;
  }

  async health(force = false): Promise<ProviderInfo> {
    const fresh = this.info.checkedAt && Date.now() - Date.parse(this.info.checkedAt) < this.healthTtlMs;
    if (!force && fresh) return this.getInfo();
    const checkedAt = new Date().toISOString();
    try {
      const res = await fetch(`${this.url}/v1/health`, { headers: this.headers(), signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as SidecarHealth;
      const model = body.models.image_embed.id;
      if (model !== this.expectedModel) {
        this.info = {
          url: this.url, reachable: false, model, dim: body.models.image_embed.dim, device: body.device, checkedAt,
          lastError: `Sidecar model ${model} does not match configured ${this.expectedModel}`,
        };
      } else {
        this.info = { url: this.url, reachable: true, model, dim: body.models.image_embed.dim, device: body.device, lastError: null, checkedAt };
      }
    } catch (err) {
      this.info = { ...this.info, reachable: false, lastError: err instanceof Error ? err.message : String(err), checkedAt };
    }
    return this.getInfo();
  }

  private async post(path: string, init: RequestInit): Promise<SidecarVectors> {
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, { ...init, signal: AbortSignal.timeout(this.requestTimeoutMs) });
    } catch (err) {
      this.info = { ...this.info, reachable: false, lastError: err instanceof Error ? err.message : String(err) };
      throw new ProviderUnavailableError(`Sidecar unreachable: ${this.info.lastError}`);
    }
    if (res.status >= 500) {
      this.info = { ...this.info, reachable: false, lastError: `HTTP ${res.status}` };
      throw new ProviderUnavailableError(`Sidecar error HTTP ${res.status}`);
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        detail = ((await res.json()) as { detail?: string }).detail ?? detail;
      } catch {
        // non-JSON error body
      }
      throw new Error(`Sidecar rejected request (${res.status}): ${detail}`);
    }
    const body = (await res.json()) as SidecarVectors;
    if (body.model !== this.expectedModel) {
      this.info = { ...this.info, reachable: false, lastError: `Sidecar model ${body.model} does not match configured ${this.expectedModel}` };
      throw new ProviderUnavailableError(this.info.lastError as string);
    }
    return body;
  }

  private toBatch(body: SidecarVectors): EmbeddingBatch {
    return { model: body.model, dim: body.dim, vectors: body.vectors.map((v) => Float32Array.from(v)) };
  }

  async embedImages(jpegs: Buffer[]): Promise<EmbeddingBatch> {
    const form = new FormData();
    jpegs.forEach((buf, i) => form.append("files", new Blob([buf], { type: "image/jpeg" }), `${i}.jpg`));
    return this.toBatch(await this.post("/v1/embed/image", { method: "POST", body: form, headers: this.headers() }));
  }

  async embedText(texts: string[]): Promise<EmbeddingBatch> {
    return this.toBatch(
      await this.post("/v1/embed/text", {
        method: "POST",
        body: JSON.stringify({ texts }),
        headers: this.headers({ "Content-Type": "application/json" }),
      }),
    );
  }
}
