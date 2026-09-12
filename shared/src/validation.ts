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

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const randomMediaQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(100).default(100),
});
