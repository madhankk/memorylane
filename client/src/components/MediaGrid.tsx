import { useState } from "react";
import { Star } from "lucide-react";
import type { MediaDto } from "@memorylane/shared";
import { api } from "../api/client";
import { formatDuration } from "../utils/format";

interface MediaGridProps {
  items: MediaDto[];
  onOpen: (index: number) => void;
}

function badgeFor(media: MediaDto): string | null {
  if (media.mediaType === "video") {
    return media.durationSeconds != null ? formatDuration(media.durationSeconds) : "▶";
  }
  if (media.livePhotoVideoId != null) return "LIVE";
  if (media.rawPairId != null) return "RAW+JPEG";
  if (media.mediaType === "raw") return "RAW";
  if (media.thumbnailStatus === "unsupported" || media.thumbnailStatus === "failed") return "!";
  return null;
}

// A standard row-major grid (not CSS-columns masonry): masonry packs items
// column-by-column, so sequential/chronological photos in a folder would
// read down the first column before continuing in the second - confusing
// for browsing. A uniform grid reads left-to-right, top-to-bottom like every
// other photo browser. Keeps the small rounded corners, border ring, and
// hover lift/zoom from the life-archive-app-inspired styling.
export default function MediaGrid({ items, onOpen }: MediaGridProps) {
  // Optimistic per-thumbnail favorite overrides - `items` is an external prop
  // that won't reflect a toggle until the parent refetches, so track it locally.
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<number, boolean>>({});

  const toggleFavorite = async (media: MediaDto) => {
    const next = !(favoriteOverrides[media.id] ?? media.favorite);
    setFavoriteOverrides((prev) => ({ ...prev, [media.id]: next }));
    try {
      await api.media.setFavorite(media.id, next);
    } catch {
      setFavoriteOverrides((prev) => ({ ...prev, [media.id]: !next }));
    }
  };

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
      {items.map((media, i) => {
        const badge = badgeFor(media);
        const hasThumbnail = media.thumbnailStatus === "done";
        const isFavorite = favoriteOverrides[media.id] ?? media.favorite;
        return (
          <button
            key={media.id}
            onClick={() => onOpen(i)}
            title={media.filename}
            className="group relative aspect-square overflow-hidden rounded-[8px] bg-media text-left shadow-media ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-media-hover"
          >
            {hasThumbnail ? (
              <img
                src={api.media.thumbnailUrl(media.id, media.thumbnailVersion)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.018]"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-2xl text-ink opacity-40">
                {media.mediaType === "video" ? "🎬" : "🖼"}
              </div>
            )}
            {badge && (
              <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
                {badge}
              </span>
            )}
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                void toggleFavorite(media);
              }}
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              className={`absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-black/50 backdrop-blur-sm transition ${
                isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <Star size={13} strokeWidth={2} className={isFavorite ? "fill-amber-400 text-amber-400" : "text-white"} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
