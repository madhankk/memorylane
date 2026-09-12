import { useEffect, useRef } from "react";

// Observes a sentinel element and calls onLoadMore when it scrolls into view,
// as long as hasMore is true and a load isn't already in flight. Attach the
// returned ref to an empty div placed after the list being paginated.
export function useInfiniteScroll(onLoadMore: () => void, hasMore: boolean, loading: boolean) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading) {
          onLoadMoreRef.current();
        }
      },
      // Start loading a bit before the sentinel actually reaches the viewport
      // so the next page is ready by the time the user scrolls to the bottom.
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  return sentinelRef;
}
