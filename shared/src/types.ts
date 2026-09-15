// Shared enums and DTOs used by both server and client.
// Keep this file free of any server-only or browser-only dependencies.

import type { VideoTranscodeQuality, ReportFacetField } from "./validation.js";

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
  // Videos in this root whose codec won't play in a browser natively - see
  // the "videos could be modernized" panel in Settings.
  transcodeCandidateCount: number;
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
  previewsBytes: number;
  vectorsBytes: number;
  facesBytes: number;
  databaseBytes: number;
  logsBytes: number;
  totalBytes: number;
  // Where all of it lives, and why (env var, Settings move, or the OS default).
  dataDir: string;
  dataDirSource: "env" | "pointer" | "default";
  // Set after a successful Move until the server restarts into the new location.
  pendingMoveTo: string | null;
}

export interface MoveDataDirRequest {
  path: string;
}

export interface MoveDataDirResultDto {
  from: string;
  to: string;
  copiedBytes: number;
  restartRequired: true;
}

export interface VersionDto {
  version: string;
}

export interface SettingsDto {
  bindAddress: string;
  port: number;
  scanIntervalDays: number | null;
  scanScheduleEnabled: boolean;
  // Burst stacking thresholds (design doc §8.3) - changing either re-queues
  // every folder for recompute.
  stackGapSeconds: number;
  stackMaxHamming: number;
  // Stacks v2: embedding cosine similarity that also counts as "same moment".
  stackMinCosine: number;
  // Master switch for provider-backed analysis (embeddings today, faces later).
  aiEnabled: boolean;
  // People (design doc §10) is opt-in: faces are biometric data.
  personsEnabled: boolean;
  // Cosine at/above which a new face joins the nearest known person.
  faceAssignThreshold: number;
  // Minimum faces for discovery to create a new "Person N".
  faceMinClusterSize: number;
  // Cosine at/above which two unassigned faces are linked during discovery.
  // Higher = stricter grouping (more, smaller persons - merge is cheap).
  faceLinkThreshold: number;
  // Which face model the sidecar should use (see FaceModelName). Changing it
  // re-detects every photo under the new model; names and corrections survive.
  faceModel: FaceModelName;
}

export type FaceModelName = "yunet-sface" | "buffalo_l";

// One of the face models the sidecar can serve (from its health report).
export interface FaceModelInfoDto {
  name: FaceModelName | string;
  id: string;
  dim: number;
  license: string;
  label: string;
}

export interface UpdateSettingsRequest {
  bindAddress?: string;
  port?: number;
  scanIntervalDays?: number | null;
  scanScheduleEnabled?: boolean;
  stackGapSeconds?: number;
  stackMaxHamming?: number;
  stackMinCosine?: number;
  aiEnabled?: boolean;
  personsEnabled?: boolean;
  faceAssignThreshold?: number;
  faceMinClusterSize?: number;
  faceLinkThreshold?: number;
  faceModel?: FaceModelName;
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
  audioCodec: string | null;

  // Set on a still photo when it's the "live" half of an Apple Live Photo -
  // the id of its paired video (fetchable at /api/media/:id/file for
  // playback). The video's own row is never surfaced as a separate grid
  // item - see the media-listing queries' live_photo_video_id exclusion.
  livePhotoVideoId: number | null;

  // Set on an image when a same-name RAW file was scanned alongside it - the
  // id of the paired RAW (fetchable at /api/media/:id/file for viewing the
  // original, e.g. for editing). The RAW row's own row is never surfaced as
  // a separate grid item - see the media-listing queries' raw_pair_id exclusion.
  rawPairId: number | null;

  // Engagement (media_engagement table) - separate from the imported EXIF/XMP
  // `rating` above, which is never overwritten by favoriting.
  favorite: boolean;

  // Stack membership (see StackRefDto) - populated by decorateMedia on every
  // listing route; null when the photo isn't in a stack.
  stack: StackRefDto | null;
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
  // null = every enabled scan root; set = a single-folder "Scan Now". Fixed
  // for the life of the run - this is its scope, not its live position.
  scanRootId: number | null;
  // Which root is actively being walked right now - updates as an
  // all-folders run moves root to root, so progress can be shown under the
  // specific folder it's working on rather than as one undifferentiated
  // blob. Null once the run finishes.
  currentScanRootId: number | null;
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
  // Cosine similarity (0-1) for semantic results; absent for text matches.
  score?: number;
}

// "Find similar" (design doc §9): nearest neighbours of one photo's embedding.
export interface SimilarResultDto {
  source: MediaDto;
  items: { media: MediaDto; score: number }[];
}

export interface RandomMediaRequest {
  count?: number;
}

export type TranscodeJobStatus = "pending" | "transcoding" | "done" | "failed" | "archived";

export interface TranscodeJobDto {
  mediaId: number;
  status: TranscodeJobStatus;
  quality: VideoTranscodeQuality;
  error: string | null;
  originalDurationSeconds: number | null;
  outputDurationSeconds: number | null;
  originalSizeBytes: number | null;
  outputSizeBytes: number | null;
  verified: boolean;
  updatedAt: string;
  archivedAt: string | null;
}

// A video in a scan root whose codec won't play natively in a browser -
// see the "videos could be modernized" panel in Settings. `job` is null
// until a transcode attempt has been started for it at least once.
export interface TranscodeCandidateDto {
  media: MediaDto;
  job: TranscodeJobDto | null;
}

export interface TranscodeCandidatesResultDto {
  items: TranscodeCandidateDto[];
  total: number;
  offset: number;
  limit: number;
  // Count of done+verified candidates across the WHOLE root, not just this
  // page - "Archive All Verified" targets this full set server-side, so its
  // displayed count needs to match regardless of how much is loaded.
  verifiedTotal: number;
}

export interface StartTranscodeRequest {
  mediaIds?: number[];
  all?: boolean;
  quality: VideoTranscodeQuality;
}

export interface ArchiveTranscodedRequest {
  mediaIds?: number[];
  all?: boolean;
}

export interface ArchiveTranscodedResultDto {
  archived: number[];
  failed: { mediaId: number; error: string }[];
}

// Background analysis pipeline (design doc §6) - per-analyzer queue counts
// shown under Settings > Analysis, polled like scan status.
export type AnalysisStatus = "pending" | "running" | "done" | "failed" | "unsupported";

export interface AnalyzerStatusDto {
  key: string;
  version: string;
  counts: Record<AnalysisStatus, number>;
  // Set while the analyzer's provider is unreachable - rows stay pending and
  // the worker retries after this time (exponential backoff, 5s to 5min).
  backoffUntil: string | null;
  // False when switched off in Settings (aiEnabled) - rows stay pending.
  enabled: boolean;
}

// The inference sidecar (memorylane-ai) as last seen by the server.
export interface ProviderStatusDto {
  url: string;
  reachable: boolean;
  model: string | null;
  dim: number | null;
  faceModel: string | null;
  faceModels: FaceModelInfoDto[];
  device: string | null;
  lastError: string | null;
  checkedAt: string | null;
}

export interface AnalysisStatusDto {
  // True while a scan is running - the worker yields to it.
  paused: boolean;
  analyzers: AnalyzerStatusDto[];
  // null when MEMORYLANE_AI_PROVIDER=none.
  provider: ProviderStatusDto | null;
}

export interface RetryAnalysisRequest {
  analyzer?: string;
}

// Focal-length report buckets (mm). Shared so the facet value the server
// emits is exactly the key the client sends back as focalMin/focalMax.
export const FOCAL_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: "0-24", label: "≤ 24 mm", min: 0, max: 24 },
  { key: "25-35", label: "25–35 mm", min: 25, max: 35 },
  { key: "36-50", label: "36–50 mm", min: 36, max: 50 },
  { key: "51-85", label: "51–85 mm", min: 51, max: 85 },
  { key: "86-135", label: "86–135 mm", min: 86, max: 135 },
  { key: "136-200", label: "136–200 mm", min: 136, max: 200 },
  { key: "201-400", label: "201–400 mm", min: 201, max: 400 },
  { key: "401-9999", label: "> 400 mm", min: 401, max: 9999 },
];

export interface FacetBucketDto {
  // The filter value to send back (lens string, "2.8", "400", focal bucket key, "2019").
  value: string;
  label: string;
  count: number;
}

// Each facet is computed with its own filter removed (standard faceted
// search): selecting a lens narrows every other panel but still shows all lenses.
export interface ReportFacetsDto {
  total: number;
  facets: Record<ReportFacetField, FacetBucketDto[]>;
}

// Stacks (design doc §8): a burst collapsed to one grid item.
export type StackKind = "burst" | "manual";

// Attached to every MediaDto that belongs to a stack.
export interface StackRefDto {
  id: number;
  count: number;
  isCover: boolean;
}

export interface StackDto {
  id: number;
  kind: StackKind;
  coverMediaId: number;
  parentFolderId: number;
  userModified: boolean;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface StackDetailDto {
  stack: StackDto;
  // Members in stack order; the cover is wherever stack.coverMediaId points.
  items: MediaDto[];
}

export interface CreateStackRequest {
  mediaIds: number[];
}
export interface SetStackCoverRequest {
  mediaId: number;
}
export interface SplitStackRequest {
  mediaIds: number[];
}
export interface MergeStacksRequest {
  stackId: number;
}
export interface RecomputeStacksRequest {
  folderId?: number;
}

// People (design doc §10.3).
export interface PersonDto {
  id: number;
  name: string | null;
  autoLabel: string; // "Person 12"
  displayName: string; // name ?? autoLabel
  coverFaceId: number | null;
  faceCount: number;
  mediaCount: number;
  hidden: boolean;
}

export interface FaceDto {
  id: number;
  mediaId: number;
  bbox: [number, number, number, number];
  detScore: number;
  quality: number;
  personId: number | null;
  assignedBy: "auto" | "user" | null;
}

export interface PersonDetailDto {
  person: PersonDto;
  faces: FaceDto[];
}

export interface RenamePersonRequest {
  name: string | null;
}
export interface HidePersonRequest {
  hidden: boolean;
}
export interface MergePersonsRequest {
  personId: number;
}
export interface AssignFaceRequest {
  personId: number | null;
}
export interface RejectFaceRequest {
  personId: number;
}
