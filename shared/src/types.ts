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

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
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

export interface VersionDto {
  version: string;
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
  thumbnailVersion: number;
  createdAt: string;
  updatedAt: string;
  // Totals across the folder's entire subtree, not just its direct children -
  // every folder-returning endpoint populates these, so a folder card reads
  // the same way whether it's a top-level "Your Library" card, a subfolder
  // you've browsed into, or a search result.
  recursiveMediaCount: number;
  recursiveSizeBytes: number;
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
  // Full path on disk - MemoryLane is a self-hosted, single-user app (the
  // viewer is always the same person who configured the scan roots
  // pointing at these paths in the first place), and Settings already
  // shows raw scan-root paths directly, so this isn't a new exposure.
  absolutePath: string;
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
  // Bumped server-side every time the thumbnail/preview files are
  // regenerated - append as a query param on thumbnail/preview URLs to
  // bust the browser's long-lived immutable cache when they change.
  thumbnailVersion: number;
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

  // Set on a still photo when it's the "live" half of an Apple Live Photo -
  // the id of its paired video (fetchable at /api/media/:id/file for
  // playback). The video's own row is never surfaced as a separate grid
  // item - see the media-listing queries' live_photo_video_id exclusion.
  livePhotoVideoId: number | null;

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
  // Thumbnail generation is a separate, often much slower phase that follows
  // indexing - these update live while a scan runs, same as the files_*
  // counts, so a large backlog is visible instead of looking stalled.
  thumbnailsQueued: number;
  thumbnailsProcessed: number;
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

export interface IgnoredPathDto {
  id: number;
  path: string;
  createdAt: string;
}

export interface IgnoreFolderResultDto {
  ignoredPath: string;
  // Folder to navigate back to, since the ignored folder itself no longer
  // exists after this - null if the ignored folder was a scan root itself.
  parentFolderId: number | null;
  removedFolderCount: number;
  removedMediaCount: number;
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
