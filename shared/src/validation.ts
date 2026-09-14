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

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
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

// "photo" covers both regular images and RAW - matches the same grouping
// used elsewhere (e.g. ELIGIBLE_MEDIA_FILTER on the server).
export const mediaTypeFilterSchema = z.enum(["all", "photo", "video"]).optional().default("all");
export type MediaTypeFilter = z.infer<typeof mediaTypeFilterSchema>;

export const folderMediaQuerySchema = paginationQuerySchema.extend({
  // When true, includes media from all descendant subfolders, not just this one.
  recursive: booleanQueryParam,
  type: mediaTypeFilterSchema,
});

export const favoritesQuerySchema = paginationQuerySchema.extend({
  type: mediaTypeFilterSchema,
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

// "standard" targets a small file (default - see the Settings video
// modernization panel); "high" trades size for extra quality margin on a
// specific clip worth it. Both preserve source resolution/frame rate.
export const videoTranscodeQualitySchema = z.enum(["standard", "high"]);
export type VideoTranscodeQuality = z.infer<typeof videoTranscodeQualitySchema>;

// `all` targets every eligible item in the scan root server-side (everything
// still needing a transcode / already verified, respectively) - not just
// whatever page of the candidate list happens to be loaded client-side, so
// "Transcode All" and "Archive All Verified" work the same whether there are
// 5 candidates or 5,000. `mediaIds` is for the per-row single-item actions.
export const startTranscodeRequestSchema = z
  .object({
    mediaIds: z.array(z.number().int().positive()).min(1).max(500).optional(),
    all: z.boolean().optional(),
    quality: videoTranscodeQualitySchema,
  })
  .refine((v) => v.all || (v.mediaIds && v.mediaIds.length > 0), { message: "mediaIds or all is required" });

export const archiveTranscodedRequestSchema = z
  .object({
    mediaIds: z.array(z.number().int().positive()).min(1).max(500).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all || (v.mediaIds && v.mediaIds.length > 0), { message: "mediaIds or all is required" });

export const transcodeCandidatesQuerySchema = paginationQuerySchema;
