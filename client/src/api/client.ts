import type {
  UserDto,
  SetupRequest,
  LoginRequest,
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
} from "@memorylane/shared";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

export const api = {
  auth: {
    me: () => request<{ user: UserDto | null; needsSetup: boolean }>("/api/auth/me"),
    setup: (body: SetupRequest) => request<{ ok: true }>("/api/auth/setup", { method: "POST", body: JSON.stringify(body) }),
    login: (body: LoginRequest) => request<{ user: UserDto }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
    logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  },
  settings: {
    get: () => request<SettingsDto>("/api/settings"),
    update: (body: UpdateSettingsRequest) => request<SettingsDto>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
    storage: () => request<StorageStatsDto>("/api/settings/storage"),
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
    media: (id: number, offset = 0, limit = 200, recursive = false) =>
      request<PaginatedResult<MediaDto>>(
        `/api/folders/${id}/media?offset=${offset}&limit=${limit}&recursive=${recursive}`,
      ),
  },
  media: {
    get: (id: number) => request<MediaDto>(`/api/media/${id}`),
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
  search: (q: string, offset = 0, limit = 50) =>
    request<PaginatedResult<SearchResultDto>>(`/api/search?q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`),
  memories: {
    random: (count = 100) => request<{ items: MediaDto[] }>(`/api/memories/random?count=${count}`),
    onThisDay: (count = 30) => request<OnThisDayResponse>(`/api/memories/on-this-day?count=${count}`),
  },
  home: {
    summary: () => request<HomeSummaryDto>("/api/home/summary"),
  },
  favorites: {
    list: (offset = 0, limit = 200) =>
      request<PaginatedResult<MediaDto>>(`/api/favorites?offset=${offset}&limit=${limit}`),
  },
};
