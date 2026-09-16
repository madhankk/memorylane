import { useEffect, useState } from "react";

export interface PreviewFrame { id: number; thumbnailVersion: number }

export function previewSequence(_cover: PreviewFrame | null, items: PreviewFrame[]): PreviewFrame[] {
  const seen = new Set<number>();
  // The idle cover may come from a nested folder (or be a video); only the
  // endpoint's direct, ready photos are eligible for the hover cycle.
  return items.filter((item) => {
    if (seen.size >= 6 || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function useHoverPreview(cover: PreviewFrame | null, load: () => Promise<PreviewFrame[]>) {
  const [hovering, setHovering] = useState(false);
  const [frame, setFrame] = useState<PreviewFrame | null>(null);

  useEffect(() => {
    if (!hovering || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setFrame(null);
      return;
    }
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const delay = setTimeout(() => {
      void load().then((items) => {
        if (cancelled) return;
        const sequence = previewSequence(cover, items);
        if (sequence.length < 2) return;
        let index = 1;
        setFrame(sequence[index]);
        interval = setInterval(() => {
          index = (index + 1) % sequence.length;
          setFrame(sequence[index]);
        }, 850);
      }).catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(delay);
      if (interval) clearInterval(interval);
    };
  }, [hovering, cover?.id, cover?.thumbnailVersion, load]);

  return { frame, onMouseEnter: () => setHovering(true), onMouseLeave: () => setHovering(false) };
}
