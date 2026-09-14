import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaDto } from "@memorylane/shared";
import { api } from "../api/client";
import MediaGrid from "../components/MediaGrid";
import Viewer from "../components/Viewer";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";

const PAGE_SIZE = 200;

export default function FavoritesPage() {
  const [media, setMedia] = useState<MediaDto[] | null>(null);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    void api.favorites.list(0, PAGE_SIZE).then((res) => {
      setMedia(res.items);
      setMediaTotal(res.total);
    });
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || media === null) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await api.favorites.list(media.length, PAGE_SIZE);
      setMedia((prev) => [...(prev ?? []), ...res.items]);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [media]);

  const hasMore = media !== null && media.length < mediaTotal;
  const sentinelRef = useInfiniteScroll(loadMore, hasMore, loadingMore);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-serif text-2xl font-semibold text-ink">Favorites</h1>

      {media === null && <p className="text-sm text-muted">Loading...</p>}
      {media && media.length === 0 && (
        <p className="text-sm text-muted">
          No favorites yet - star a photo from the viewer or from a folder grid to see it here.
        </p>
      )}
      {media && media.length > 0 && <MediaGrid items={media} onOpen={setViewerIndex} />}

      {hasMore && (
        <div ref={sentinelRef} className="flex min-h-[60px] items-center justify-center text-sm">
          {loadingMore && (
            <span className="text-muted">
              Loading more ({media?.length ?? 0} / {mediaTotal})...
            </span>
          )}
        </div>
      )}

      {media && viewerIndex !== null && (
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
