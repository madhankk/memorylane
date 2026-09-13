import { useState } from "react";
import { Star } from "lucide-react";
import type { MediaDto } from "@memorylane/shared";
import { api } from "../api/client";

interface MediaGridProps {
  items: MediaDto[];
  onOpen: (index: number) => void;
}

function badgeFor(media: MediaDto): string | null {
  if (media.mediaType === "video") return "▶";
  if (media.mediaType === "raw") return "RAW";
  if (media.thumbnailStatus === "unsupported" || media.thumbnailStatus === "failed") return "!";
  return null;
}

// Mirrors life-archive-app's AlbumPhotoGrid masonry view: CSS columns so each
// thumbnail keeps its natural aspect ratio, small rounded corners, a subtle
// border ring, and a hover lift + zoom. Denser (smaller gap, more columns)
// than the source app since MemoryLane favors seeing more photos at once.
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
    <div className="columns-2 gap-2 sm:columns-3 lg:columns-4 2xl:columns-5">
      {items.map((media, i) => {
        const badge = badgeFor(media);
        const hasThumbnail = media.thumbnailStatus === "done";
        const isFavorite = favoriteOverrides[media.id] ?? media.favorite;
        return (
          <button
            key={media.id}
            onClick={() => onOpen(i)}
            title={media.filename}
            className="group relative mb-2 block w-full break-inside-avoid overflow-hidden rounded-[8px] bg-media text-left shadow-media ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-media-hover"
          >
            {hasThumbnail ? (
              <img
                src={api.media.thumbnailUrl(media.id)}
                alt=""
                loading="lazy"
                className="h-auto w-full transition duration-500 group-hover:scale-[1.018]"
              />
            ) : (
              <div className="flex h-40 items-center justify-center text-2xl text-ink opacity-40">
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
