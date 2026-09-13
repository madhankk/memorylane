// Shared enums and DTOs used by both server and client.
// Keep this file free of any server-only or browser-only dependencies.

export type MediaType = "image" | "raw" | "video";

export type ThumbnailStatus = "pending" | "done" | "failed" | "unsupported";

export type MediaStatus = "active" | "missing";

export type ScanTrigger = "manual" | "scheduled";

export type ScanRunStatus = "running" | "completed" | "failed";

export interface UserDto {
  id: number;
  username: string;
  createdAt: string;
}

export interface SetupRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface ScanRootStatsDto {
  mediaCount: number;
  photoCount: number;
  rawCount: number;
  videoCount: number;
  folderCount: number;
  totalSizeBytes: number;
  pendingThumbnails: number;
  failedThumbnails: number;
}

export interface ScanRootDto {
  id: number;
  path: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  stats: ScanRootStatsDto;
}

export type MoveDirection = "up" | "down";

export interface MoveScanRootRequest {
  direction: MoveDirection;
}

export interface CreateScanRootRequest {
  path: string;
}

export interface UpdateScanRootRequest {
  enabled?: boolean;
}

export interface StorageStatsDto {
  thumbnailCacheBytes: number;
  databaseBytes: number;
  logsBytes: number;
  totalBytes: number;
}

export interface SettingsDto {
  bindAddress: string;
  port: number;
  scanIntervalDays: number | null;
  scanScheduleEnabled: boolean;
}

export interface UpdateSettingsRequest {
  bindAddress?: string;
  port?: number;
  scanIntervalDays?: number | null;
  scanScheduleEnabled?: boolean;
}

export interface FolderDto {
  id: number;
  scanRootId: number;
  parentId: number | null;
  name: string;
  absolutePath: string;
  mediaCount: number;
  childFolderCount: number;
  thumbnailMediaId: number | null;
  createdAt: string;
  updatedAt: string;
  // Only populated for top-level folders (GET /api/folders) - totals across
  // the entire subtree, not just this folder's direct children. Undefined
  // for folders returned from /children or /:id, which stay direct-count-only.
  recursiveMediaCount?: number;
  recursiveSizeBytes?: number;
}

export interface FolderBreadcrumbDto {
  id: number;
  name: string;
}

export interface MediaDto {
  id: number;
  parentFolderId: number;
  scanRootId: number;
  filename: string;
  extension: string;
  mediaType: MediaType;
  fileSize: number;
  fsCreatedAt: string | null;
  fsModifiedAt: string;
  capturedDate: string | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
  thumbnailStatus: ThumbnailStatus;
  status: MediaStatus;

  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  focalLength: number | null;
  aperture: number | null;
  shutterSpeed: string | null;
  iso: number | null;
  rating: number | null;
  gpsLat: number | null;
  gpsLon: number | null;

  durationSeconds: number | null;
  codec: string | null;

  // Engagement (media_engagement table) - separate from the imported EXIF/XMP
  // `rating` above, which is never overwritten by favoriting.
  favorite: boolean;
}

export interface UpdateFavoriteRequest {
  favorite: boolean;
}

export interface FavoriteResultDto {
  mediaId: number;
  favorite: boolean;
  favoritedAt: string | null;
}

export interface ScanRunDto {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: ScanRunStatus;
  filesScanned: number;
  filesNew: number;
  filesChanged: number;
  filesRemoved: number;
  errorCount: number;
  trigger: ScanTrigger;
  // null = every enabled scan root; set = a single-folder "Scan Now".
  scanRootId: number | null;
}

export interface ScanStatusDto {
  running: boolean;
  currentRun: ScanRunDto | null;
  lastRun: ScanRunDto | null;
  lastSuccessfulRun: ScanRunDto | null;
  nextScheduledAt: string | null;
}

export interface RunScanRequest {
  scanRootId?: number;
}

export interface HomeSummaryDto {
  mediaCount: number;
  folderCount: number;
  totalSizeBytes: number;
  yearSpan: number;
  // A randomly picked photo to use as the hero background - null if nothing indexed yet.
  heroMedia: MediaDto | null;
}

// "This Day, Another Time" degrades gracefully: exact same day-of-year across
// years, then the surrounding week, then the whole month - whichever tier
// first turns up results.
export type OnThisDayTier = "day" | "week" | "month" | "none";

export interface OnThisDayResponse {
  tier: OnThisDayTier;
  items: MediaDto[];
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export type SearchResultType = "folder" | "media";

export interface SearchResultDto {
  type: SearchResultType;
  folder?: FolderDto;
  media?: MediaDto;
}

export interface RandomMediaRequest {
  count?: number;
}
