import { z } from "zod";

// Password policy kept simple for a single-admin, self-hosted v1.
export const passwordSchema = z.string().min(8).max(200);
export const usernameSchema = z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/);

export const setupRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(200),
});

export const createScanRootRequestSchema = z.object({
  path: z.string().min(1).max(4096),
});

export const updateScanRootRequestSchema = z.object({
  enabled: z.boolean().optional(),
});

export const moveScanRootRequestSchema = z.object({
  direction: z.enum(["up", "down"]),
});

export const updateSettingsRequestSchema = z.object({
  bindAddress: z.string().min(1).max(64).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  scanIntervalDays: z.number().int().min(1).max(365).nullable().optional(),
  scanScheduleEnabled: z.boolean().optional(),
});

export const paginationQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// z.coerce.boolean() is unsuitable for query strings: Boolean("false") is
// `true` in JS, so "recursive=false" would coerce to true. Parse the literal
// string instead.
const booleanQueryParam = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

export const folderMediaQuerySchema = paginationQuerySchema.extend({
  // When true, includes media from all descendant subfolders, not just this one.
  recursive: booleanQueryParam,
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const randomMediaQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(100).default(100),
});

export const runScanRequestSchema = z.object({
  scanRootId: z.number().int().positive().optional(),
});

export const updateFavoriteRequestSchema = z.object({
  favorite: z.boolean(),
});
