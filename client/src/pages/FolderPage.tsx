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

  if (!folder) return <p className="muted">Loading...</p>;

  return (
    <div className="folder-page">
      <Breadcrumbs items={breadcrumbs} />
      <div className="folder-page-header">
        <h1>{folder.name}</h1>
        <label className="all-files-toggle">
          <input type="checkbox" checked={showAllFiles} onChange={(e) => void toggleAllFiles(e.target.checked)} />
          All files
        </label>
      </div>

      {!showAllFiles && children.length > 0 && (
        <div className="folder-grid">
          {children.map((c) => (
            <FolderCard key={c.id} folder={c} />
          ))}
        </div>
      )}

      {media.length > 0 && <MediaGrid items={media} onOpen={setViewerIndex} />}

      {!showAllFiles && children.length === 0 && media.length === 0 && (
        <p className="muted">This folder is empty.</p>
      )}
      {showAllFiles && media.length === 0 && <p className="muted">No files in this folder or its subfolders.</p>}

      {hasMore && (
        <div ref={sentinelRef} className="load-more-sentinel">
          {loadingMore && <span className="muted">Loading more ({media.length} / {mediaTotal})...</span>}
        </div>
      )}

      {viewerIndex !== null && (
        <Viewer items={media} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </div>
  );
}
