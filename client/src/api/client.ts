import type {
  UserDto,
  SetupRequest,
  LoginRequest,
  ChangePasswordRequest,
  SettingsDto,
  UpdateSettingsRequest,
  ScanRootDto,
  CreateScanRootRequest,
  UpdateScanRootRequest,
  MoveDirection,
  ScanStatusDto,
  ScanRunDto,
  FolderDto,
  FolderBreadcrumbDto,
  MediaDto,
  PaginatedResult,
  SearchResultDto,
  HomeSummaryDto,
  StorageStatsDto,
  OnThisDayResponse,
  FavoriteResultDto,
  IgnoredPathDto,
  IgnoreFolderResultDto,
  VersionDto,
  MediaTypeFilter,
  VideoTranscodeQuality,
  TranscodeCandidatesResultDto,
  TranscodeJobDto,
  ArchiveTranscodedResultDto,
  ReportFacetsDto,
  ExifFilterQuery,
  AnalysisStatusDto,
  StackDto,
  StackDetailDto,
  MoveDataDirResultDto,
  SimilarResultDto,
  SearchMode,
  PersonDto,
  PersonDetailDto,
  FaceDto,
} from "@memorylane/shared";
import { trackPageRead } from "../utils/pageLoad";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const finish = !init?.method || init.method.toUpperCase() === "GET" ? trackPageRead() : () => {};
  try {
    return await performRequest<T>(path, init);
  } finally {
    finish();
  }
}

async function performRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    // Only set Content-Type when there's an actual JSON body - Fastify rejects
    // a request that declares application/json but sends an empty body (e.g.
    // GET/DELETE calls), which every request here would otherwise trigger.
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  return (await res.json()) as T;
}

export { ApiError };

export type ReportFilters = ExifFilterQuery & { type?: MediaTypeFilter; personIds?: string };

// Serialises only defined filter values, so the same object drives the
// grid request, the facets request, and the CSV link.
export function toQueryString(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && !(k === "type" && v === "all")) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  auth: {
    me: () => request<{ user: UserDto | null; needsSetup: boolean }>("/api/auth/me"),
    setup: (body: SetupRequest) => request<{ ok: true }>("/api/auth/setup", { method: "POST", body: JSON.stringify(body) }),
    login: (body: LoginRequest) => request<{ user: UserDto }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
    logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    changePassword: (body: ChangePasswordRequest) =>
      request<{ ok: true }>("/api/auth/password", { method: "PUT", body: JSON.stringify(body) }),
  },
  settings: {
    get: () => request<SettingsDto>("/api/settings"),
    update: (body: UpdateSettingsRequest) => request<SettingsDto>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
    storage: () => request<StorageStatsDto>("/api/settings/storage"),
    moveDataDir: (path: string) => request<MoveDataDirResultDto>("/api/settings/data-dir", { method: "POST", body: JSON.stringify({ path }) }),
    version: () => request<VersionDto>("/api/settings/version"),
  },
  scanRoots: {
    list: () => request<ScanRootDto[]>("/api/scan-roots"),
    create: (body: CreateScanRootRequest) => request<ScanRootDto>("/api/scan-roots", { method: "POST", body: JSON.stringify(body) }),
    update: (id: number, body: UpdateScanRootRequest) => request<ScanRootDto>(`/api/scan-roots/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: number) => request<void>(`/api/scan-roots/${id}`, { method: "DELETE" }),
    move: (id: number, direction: MoveDirection) =>
      request<ScanRootDto[]>(`/api/scan-roots/${id}/move`, { method: "POST", body: JSON.stringify({ direction }) }),
  },
  scans: {
    run: (scanRootId?: number) =>
      request<{ ok: true }>("/api/scans/run", {
        method: "POST",
        body: scanRootId !== undefined ? JSON.stringify({ scanRootId }) : undefined,
      }),
    status: () => request<ScanStatusDto>("/api/scans/status"),
    history: () => request<ScanRunDto[]>("/api/scans/history"),
  },
  folders: {
    listTop: () => request<FolderDto[]>("/api/folders"),
    get: (id: number) => request<{ folder: FolderDto; breadcrumbs: FolderBreadcrumbDto[] }>(`/api/folders/${id}`),
    children: (id: number, offset = 0, limit = 100) =>
      request<PaginatedResult<FolderDto>>(`/api/folders/${id}/children?offset=${offset}&limit=${limit}`),
    media: (id: number, offset = 0, limit = 200, recursive = false, type: MediaTypeFilter = "all", expandStacks = false) =>
      request<PaginatedResult<MediaDto>>(
        `/api/folders/${id}/media?offset=${offset}&limit=${limit}&recursive=${recursive}&type=${type}&expandStacks=${expandStacks}`,
      ),
    ignore: (id: number) => request<IgnoreFolderResultDto>(`/api/folders/${id}/ignore`, { method: "POST" }),
  },
  ignoredPaths: {
    list: () => request<IgnoredPathDto[]>("/api/ignored-paths"),
    remove: (id: number) => request<void>(`/api/ignored-paths/${id}`, { method: "DELETE" }),
  },
  media: {
    list: (filters: ReportFilters, offset = 0, limit = 200) =>
      request<PaginatedResult<MediaDto>>(`/api/media${toQueryString({ ...filters, offset, limit })}`),
    get: (id: number) => request<MediaDto>(`/api/media/${id}`),
    similar: (id: number, limit = 48) => request<SimilarResultDto>(`/api/media/${id}/similar?limit=${limit}`),
    faces: (id: number) => request<FaceDto[]>(`/api/media/${id}/faces`),
    fileUrl: (id: number) => `/api/media/${id}/file`,
    // `v` busts the browser's 1-year immutable cache when the thumbnail/preview
    // is regenerated (e.g. after an orientation fix) - see thumbnail_version.
    thumbnailUrl: (id: number, v = 0) => `/api/media/${id}/thumbnail?v=${v}`,
    previewUrl: (id: number, v = 0) => `/api/media/${id}/preview?v=${v}`,
    setFavorite: (id: number, favorite: boolean) =>
      request<FavoriteResultDto>(`/api/media/${id}/favorite`, { method: "PUT", body: JSON.stringify({ favorite }) }),
    // Fire-and-forget engagement signals - callers should not await these on
    // any interactive path, just let them settle in the background.
    markShown: (id: number) => request<{ ok: true }>(`/api/media/${id}/shown`, { method: "POST" }),
    markViewed: (id: number) => request<{ ok: true }>(`/api/media/${id}/viewed`, { method: "POST" }),
  },
  search: (q: string, offset = 0, limit = 50, mode: SearchMode = "text") =>
    request<PaginatedResult<SearchResultDto>>(`/api/search?q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}&mode=${mode}`),
  memories: {
    random: (count = 100) => request<{ items: MediaDto[] }>(`/api/memories/random?count=${count}`),
    onThisDay: (count = 30) => request<OnThisDayResponse>(`/api/memories/on-this-day?count=${count}`),
  },
  home: {
    summary: () => request<HomeSummaryDto>("/api/home/summary"),
  },
  reports: {
    facets: (filters: ReportFilters) => request<ReportFacetsDto>(`/api/reports/facets${toQueryString(filters)}`),
    exportUrl: (filters: ReportFilters) => `/api/reports/export.csv${toQueryString(filters)}`,
  },
  stacks: {
    get: (id: number) => request<StackDetailDto>(`/api/stacks/${id}`),
    create: (mediaIds: number[]) => request<StackDto>("/api/stacks", { method: "POST", body: JSON.stringify({ mediaIds }) }),
    setCover: (id: number, mediaId: number) =>
      request<StackDto>(`/api/stacks/${id}/cover`, { method: "POST", body: JSON.stringify({ mediaId }) }),
    split: (id: number, mediaIds: number[]) =>
      request<StackDto>(`/api/stacks/${id}/split`, { method: "POST", body: JSON.stringify({ mediaIds }) }),
    merge: (id: number, stackId: number) =>
      request<StackDto>(`/api/stacks/${id}/merge`, { method: "POST", body: JSON.stringify({ stackId }) }),
    removeMember: (id: number, mediaId: number) =>
      request<{ stack: StackDto | null }>(`/api/stacks/${id}/members/${mediaId}`, { method: "DELETE" }),
    remove: (id: number) => request<void>(`/api/stacks/${id}`, { method: "DELETE" }),
    // Marks folders for recompute; the work happens on the analysis worker's
    // next idle pass, so callers should expect eventual consistency.
    recompute: (folderId?: number) =>
      request<{ folders: number }>("/api/stacks/recompute", {
        method: "POST",
        body: JSON.stringify(folderId !== undefined ? { folderId } : {}),
      }),
  },
  persons: {
    list: (includeHidden = false) => request<PersonDto[]>(`/api/persons?includeHidden=${includeHidden}`),
    get: (id: number) => request<PersonDetailDto>(`/api/persons/${id}`),
    faces: (id: number, offset = 0, limit = 100) => request<FaceDto[]>(`/api/persons/${id}/faces?offset=${offset}&limit=${limit}`),
    rename: (id: number, name: string | null) => request<PersonDto>(`/api/persons/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    setHidden: (id: number, hidden: boolean) => request<PersonDto>(`/api/persons/${id}`, { method: "PATCH", body: JSON.stringify({ hidden }) }),
    merge: (id: number, personId: number) => request<PersonDto>(`/api/persons/${id}/merge`, { method: "POST", body: JSON.stringify({ personId }) }),
    remove: (id: number) => request<void>(`/api/persons/${id}`, { method: "DELETE" }),
    discover: () => request<{ persons: number; assigned: number }>("/api/persons/discover", { method: "POST" }),
    regroup: () => request<{ persons: number; assigned: number }>("/api/persons/regroup", { method: "POST" }),
    deleteAllData: () => request<void>("/api/persons/data", { method: "DELETE" }),
  },
  faces: {
    cropUrl: (id: number) => `/api/faces/${id}/crop`,
    assign: (id: number, personId: number | null) => request<FaceDto>(`/api/faces/${id}/assign`, { method: "POST", body: JSON.stringify({ personId }) }),
    reject: (id: number, personId: number) => request<FaceDto>(`/api/faces/${id}/reject`, { method: "POST", body: JSON.stringify({ personId }) }),
  },
  analysis: {
    status: () => request<AnalysisStatusDto>("/api/analysis/status"),
    retryFailed: (analyzer?: string) =>
      request<{ requeued: number }>("/api/analysis/retry", { method: "POST", body: JSON.stringify(analyzer ? { analyzer } : {}) }),
  },
  favorites: {
    list: (offset = 0, limit = 200, type: MediaTypeFilter = "all") =>
      request<PaginatedResult<MediaDto>>(`/api/favorites?offset=${offset}&limit=${limit}&type=${type}`),
  },
  transcode: {
    candidates: (scanRootId: number, offset = 0, limit = 50) =>
      request<TranscodeCandidatesResultDto>(
        `/api/scan-roots/${scanRootId}/transcode-candidates?offset=${offset}&limit=${limit}`,
      ),
    // Pass either `mediaIds` (a specific row) or `all: true` (every eligible
    // item in the root, resolved server-side - see the route) - never both.
    start: (scanRootId: number, target: { mediaIds: number[]; quality: VideoTranscodeQuality } | { all: true; quality: VideoTranscodeQuality }) =>
      request<{ ok: true; count: number }>(`/api/scan-roots/${scanRootId}/transcode/start`, {
        method: "POST",
        body: JSON.stringify(target),
      }),
    status: (scanRootId: number) => request<TranscodeJobDto[]>(`/api/scan-roots/${scanRootId}/transcode/status`),
    archive: (scanRootId: number, target: { mediaIds: number[] } | { all: true }) =>
      request<ArchiveTranscodedResultDto>(`/api/scan-roots/${scanRootId}/transcode/archive`, {
        method: "POST",
        body: JSON.stringify(target),
      }),
    previewUrl: (mediaId: number) => `/api/media/${mediaId}/transcode-preview`,
    previewThumbnailUrl: (mediaId: number) => `/api/media/${mediaId}/transcode-preview-thumbnail`,
  },
};
