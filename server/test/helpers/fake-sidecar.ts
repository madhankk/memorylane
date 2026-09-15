import Fastify, { type FastifyInstance } from "fastify";

// Minimal in-process stand-in for memorylane-ai implementing the /v1
// contract with deterministic, tiny vectors so provider/analyzer/route tests
// never need the real model. Image vectors derive from the byte content
// (same bytes -> same vector), text vectors from the words.
export interface FakeSidecar {
  url: string;
  model: string;
  dim: number;
  calls: { images: number; texts: number };
  setFailing(status: number | null): void;
  close(): Promise<void>;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function vectorForBytes(bytes: Uint8Array, dim: number): number[] {
  const v = new Array(dim).fill(0);
  for (let i = 0; i < bytes.length; i++) v[i % dim] += bytes[i] + 1;
  return normalize(v);
}

export function vectorForText(text: string, dim: number): number[] {
  const v = new Array(dim).fill(0);
  for (const word of text.toLowerCase().split(/\s+/)) {
    let h = 7;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % dim] += 1;
  }
  return normalize(v);
}

// Splits a multipart body on its boundary and returns each file part's bytes.
function parseMultipart(body: Buffer, contentType: string): Buffer[] {
  const boundary = contentType.match(/boundary=([^;]+)/)?.[1];
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const chunk = body.subarray(start + delimiter.length, next);
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd !== -1) parts.push(chunk.subarray(headerEnd + 4, chunk.length - 2)); // strip trailing CRLF
    start = next;
  }
  return parts;
}

export async function startFakeSidecar(opts: { model?: string; dim?: number } = {}): Promise<FakeSidecar> {
  const model = opts.model ?? "clip-vit-base-patch32@1";
  const dim = opts.dim ?? 8;
  let failing: number | null = null;
  const calls = { images: 0, texts: 0 };
  const app: FastifyInstance = Fastify({ logger: false });
  app.addContentTypeParser("multipart/form-data", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.get("/v1/health", async (_req, reply) => {
    if (failing) return reply.code(failing).send({ detail: "failing" });
    return { ok: true, device: "fake", providers: ["FakeExecutionProvider"], max_batch: 32, models: { image_embed: { id: model, dim }, text_embed: { id: model, dim } } };
  });
  app.post("/v1/embed/image", async (req, reply) => {
    if (failing) return reply.code(failing).send({ detail: "failing" });
    calls.images++;
    const files = parseMultipart(req.body as Buffer, req.headers["content-type"] ?? "");
    if (files.length === 0) return reply.code(422).send({ detail: "no files" });
    return { model, dim, vectors: files.map((f) => vectorForBytes(f, dim)) };
  });
  app.post("/v1/embed/text", async (req, reply) => {
    if (failing) return reply.code(failing).send({ detail: "failing" });
    calls.texts++;
    const { texts } = req.body as { texts: string[] };
    if (!texts?.length) return reply.code(422).send({ detail: "no texts" });
    return { model, dim, vectors: texts.map((t) => vectorForText(t, dim)) };
  });

  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  return {
    url: address,
    model,
    dim,
    calls,
    setFailing: (status) => {
      failing = status;
    },
    close: () => app.close(),
  };
}
