import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { FolderDto, FolderBreadcrumbDto, MediaDto } from "@memorylane/shared";
import { api } from "../api/client";
import Breadcrumbs from "../components/Breadcrumbs";
import FolderCard from "../components/FolderCard";
import MediaGrid from "../components/MediaGrid";
import Viewer from "../components/Viewer";

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

  const load = useCallback(async () => {
    const [detail, childrenRes, mediaRes] = await Promise.all([
      api.folders.get(folderId),
      api.folders.children(folderId, 0, 500),
      api.folders.media(folderId, 0, PAGE_SIZE),
    ]);
    setFolder(detail.folder);
    setBreadcrumbs(detail.breadcrumbs);
    setChildren(childrenRes.items);
    setMedia(mediaRes.items);
    setMediaTotal(mediaRes.total);
  }, [folderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    const res = await api.folders.media(folderId, media.length, PAGE_SIZE);
    setMedia((prev) => [...prev, ...res.items]);
  };

  if (!folder) return <p className="muted">Loading...</p>;

  return (
    <div className="folder-page">
      <Breadcrumbs items={breadcrumbs} />
      <h1>{folder.name}</h1>

      {children.length > 0 && (
        <div className="folder-grid">
          {children.map((c) => (
            <FolderCard key={c.id} folder={c} />
          ))}
        </div>
      )}

      {media.length > 0 && <MediaGrid items={media} onOpen={setViewerIndex} />}

      {children.length === 0 && media.length === 0 && <p className="muted">This folder is empty.</p>}

      {media.length < mediaTotal && (
        <button className="load-more" onClick={loadMore}>
          Load more ({media.length} / {mediaTotal})
        </button>
      )}

      {viewerIndex !== null && (
        <Viewer items={media} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </div>
  );
}
