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

export default function MediaGrid({ items, onOpen }: MediaGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
      {items.map((media, i) => {
        const badge = badgeFor(media);
        const hasThumbnail = media.thumbnailStatus === "done";
        return (
          <button
            key={media.id}
            onClick={() => onOpen(i)}
            title={media.filename}
            className="relative aspect-square overflow-hidden rounded-md bg-media p-0"
          >
            {hasThumbnail ? (
              <img src={api.media.thumbnailUrl(media.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
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
          </button>
        );
      })}
    </div>
  );
}
