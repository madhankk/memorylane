import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EyeOff, MoreVertical } from "lucide-react";
import type { FolderDto, FolderBreadcrumbDto, MediaDto, MediaTypeFilter as MediaTypeFilterValue } from "@memorylane/shared";
import { api } from "../api/client";
import Breadcrumbs from "../components/Breadcrumbs";
import FolderCard from "../components/FolderCard";
import MediaGrid from "../components/MediaGrid";
import MediaTypeFilter from "../components/MediaTypeFilter";
import Viewer from "../components/Viewer";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";

const PAGE_SIZE = 200;

export default function FolderPage() {
  const { id } = useParams<{ id: string }>();
  const folderId = Number(id);
  const navigate = useNavigate();

  const [folder, setFolder] = useState<FolderDto | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<FolderBreadcrumbDto[]>([]);
  const [children, setChildren] = useState<FolderDto[]>([]);
  const [media, setMedia] = useState<MediaDto[]>([]);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // "All files" flattens every subfolder's media into one list, instead of
  // showing only this folder's direct children/media.
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [mediaType, setMediaType] = useState<MediaTypeFilterValue>("all");
  const [loadingMore, setLoadingMore] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const loadingMoreRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  const loadMedia = useCallback(
    async (recursive: boolean, type: MediaTypeFilterValue) => {
      const res = await api.folders.media(folderId, 0, PAGE_SIZE, recursive, type);
      setMedia(res.items);
      setMediaTotal(res.total);
    },
    [folderId],
  );

  const load = useCallback(async () => {
    const [detail, childrenRes] = await Promise.all([
      api.folders.get(folderId),
      api.folders.children(folderId, 0, 500),
    ]);
    setFolder(detail.folder);
    setBreadcrumbs(detail.breadcrumbs);
    setChildren(childrenRes.items);
    await loadMedia(false, "all");
  }, [folderId, loadMedia]);

  // Reset to the normal (non-flattened) view and reload whenever navigating to a different folder.
  useEffect(() => {
    setShowAllFiles(false);
    setMediaType("all");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  const toggleAllFiles = async (checked: boolean) => {
    setShowAllFiles(checked);
    await loadMedia(checked, mediaType);
  };

  const changeMediaType = async (type: MediaTypeFilterValue) => {
    setMediaType(type);
    await loadMedia(showAllFiles, type);
  };

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await api.folders.media(folderId, media.length, PAGE_SIZE, showAllFiles, mediaType);
      setMedia((prev) => [...prev, ...res.items]);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [folderId, media.length, showAllFiles, mediaType]);

  const hasMore = media.length < mediaTotal;
  const sentinelRef = useInfiniteScroll(loadMore, hasMore, loadingMore);

  const ignoreFolder = async () => {
    if (!folder) return;
    setMenuOpen(false);
    const itemsPhrase = folder.recursiveMediaCount > 0 ? ` and ${folder.recursiveMediaCount.toLocaleString()} indexed item(s) in it` : "";
    if (
      !confirm(
        `Ignore "${folder.name}"?\n\nMemoryLane will stop scanning this folder${itemsPhrase} will be removed from your library. Original files on disk are never touched - you can remove it from the ignore list in Settings later and rescan to bring it back.`,
      )
    ) {
      return;
    }
    setIgnoring(true);
    try {
      const result = await api.folders.ignore(folder.id);
      navigate(result.parentFolderId ? `/folder/${result.parentFolderId}` : "/");
    } finally {
      setIgnoring(false);
    }
  };

  if (!folder) return <p className="text-sm text-muted">Loading...</p>;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Breadcrumbs items={breadcrumbs} />
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-serif text-2xl font-semibold text-ink">{folder.name}</h1>
          <div className="flex items-center gap-4">
            <MediaTypeFilter value={mediaType} onChange={(t) => void changeMediaType(t)} />
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm text-muted">
              <input
                type="checkbox"
                checked={showAllFiles}
                onChange={(e) => void toggleAllFiles(e.target.checked)}
                className="cursor-pointer accent-accent"
              />
              All files
            </label>
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="More options"
                title="More options"
                className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
              >
                <MoreVertical size={16} strokeWidth={1.8} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-border bg-surface py-1 shadow-card">
                  <button
                    onClick={() => void ignoreFolder()}
                    disabled={ignoring}
                    className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm text-muted hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <EyeOff size={14} strokeWidth={1.8} />
                    {ignoring ? "Ignoring..." : "Ignore folder"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {!showAllFiles && children.length > 0 && (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
          {children.map((c) => (
            <FolderCard key={c.id} folder={c} />
          ))}
        </div>
      )}

      {media.length > 0 && <MediaGrid items={media} onOpen={setViewerIndex} />}

      {!showAllFiles && children.length === 0 && media.length === 0 && (
        <p className="text-sm text-muted">
          {mediaType === "all" ? "This folder is empty." : `No ${mediaType === "photo" ? "photos" : "videos"} in this folder.`}
        </p>
      )}
      {showAllFiles && media.length === 0 && (
        <p className="text-sm text-muted">
          {mediaType === "all"
            ? "No files in this folder or its subfolders."
            : `No ${mediaType === "photo" ? "photos" : "videos"} in this folder or its subfolders.`}
        </p>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="flex min-h-[60px] items-center justify-center text-sm">
          {loadingMore && (
            <span className="text-muted">
              Loading more ({media.length} / {mediaTotal})...
            </span>
          )}
        </div>
      )}

      {viewerIndex !== null && (
        <Viewer
          items={media}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          total={mediaTotal}
          onRequestMore={loadMore}
        />
      )}
    </div>
  );
}
