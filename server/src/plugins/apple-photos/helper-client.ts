import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CatalogPage } from "./sync.js";

const faceSchema = z.object({ name: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const assetSchema = z.object({
  uuid: z.string().min(1), original_filename: z.string().nullable(),
  original_path: z.string().nullable(), derivative_path: z.string().nullable(),
  original_available: z.boolean(), date: z.string().nullable(),
  title: z.string().nullable(), description: z.string().nullable(), keywords: z.array(z.string()),
  favorite: z.boolean(), hidden: z.boolean(), in_trash: z.boolean(),
  latitude: z.number().nullable(), longitude: z.number().nullable(), faces: z.array(faceSchema),
});
const pageSchema = z.object({ assets: z.array(assetSchema).max(500), next_cursor: z.number().int().nonnegative().nullable(), total: z.number().int().nonnegative() });

function helperUrl(): string {
  const rawPort = process.env.MEMORYLANE_PHOTOS_HELPER_PORT ?? "4282";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Photos helper port");
  return `http://127.0.0.1:${port}`;
}

async function helperRequest(dataDir: string, endpoint: string, body?: unknown): Promise<unknown> {
  let token: string;
  try {
    token = (await fs.readFile(path.join(dataDir, "photos-helper-token"), "utf8")).trim();
  } catch {
    throw new Error("Photos helper token is missing; run npm run photos-helper");
  }
  if (!token) throw new Error("Photos helper token is empty; run npm run photos-helper");
  let response: Response;
  try {
    response = await fetch(`${helperUrl()}${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-MemoryLane-Token": token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error("Photos helper is not reachable; run npm run photos-helper");
  }
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(error.success ? error.data.error : `Photos helper returned HTTP ${response.status}`);
  }
  return payload;
}

export async function photosHelperHealth(dataDir: string): Promise<{ status: "ready" }> {
  return z.object({ status: z.literal("ready") }).parse(await helperRequest(dataDir, "/health"));
}

export async function fetchCatalogPage(dataDir: string, libraryPath: string, cursor: number): Promise<CatalogPage> {
  return pageSchema.parse(await helperRequest(dataDir, "/catalog", { library_path: libraryPath, cursor, limit: 200 }));
}
