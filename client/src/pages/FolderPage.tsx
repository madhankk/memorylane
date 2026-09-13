import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { FolderDto, FolderBreadcrumbDto, MediaDto } from "@memorylane/shared";
import { api } from "../api/client";
import Breadcrumbs from "../components/Breadcrumbs";
import FolderCard from "../components/FolderCard";
import MediaGrid from "../components/MediaGrid";
import Viewer from "../components/Viewer";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";

const PAGE_SIZE = 200;

export default function FolderPage() {
  const { id } = useParams<{ id: string }>();
  const folderId = Number(id);

  const [folder, setFolder] = useState<FolderDto | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<FolderBreadcrumbDto[]>([]);
  const [children, setChildren] = useState<FolderDto[]>([]);
  const [media, setMedia] = useState<MediaDto[]>([]);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // "All files" flattens every subfolder's media into one list, instead of
  // showing only this folder's direct children/media.
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const loadMedia = useCallback(
    async (recursive: boolean) => {
      const res = await api.folders.media(folderId, 0, PAGE_SIZE, recursive);
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
    await loadMedia(false);
  }, [folderId, loadMedia]);

  // Reset to the normal (non-flattened) view and reload whenever navigating to a different folder.
  useEffect(() => {
    setShowAllFiles(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  const toggleAllFiles = async (checked: boolean) => {
    setShowAllFiles(checked);
    await loadMedia(checked);
  };

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await api.folders.media(folderId, media.length, PAGE_SIZE, showAllFiles);
      setMedia((prev) => [...prev, ...res.items]);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [folderId, media.length, showAllFiles]);

  const hasMore = media.length < mediaTotal;
  const sentinelRef = useInfiniteScroll(loadMore, hasMore, loadingMore);

  if (!folder) return <p className="text-sm text-muted">Loading...</p>;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Breadcrumbs items={breadcrumbs} />
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-serif text-2xl font-semibold text-ink">{folder.name}</h1>
          <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm text-muted">
            <input
              type="checkbox"
              checked={showAllFiles}
              onChange={(e) => void toggleAllFiles(e.target.checked)}
              className="cursor-pointer accent-accent"
            />
            All files
          </label>
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
        <p className="text-sm text-muted">This folder is empty.</p>
      )}
      {showAllFiles && media.length === 0 && (
        <p className="text-sm text-muted">No files in this folder or its subfolders.</p>
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
        <Viewer items={media} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </div>
  );
}
