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
    <div className="media-grid">
      {items.map((media, i) => {
        const badge = badgeFor(media);
        const hasThumbnail = media.thumbnailStatus === "done";
        return (
          <button key={media.id} className="media-card" onClick={() => onOpen(i)} title={media.filename}>
            {hasThumbnail ? (
              <img src={api.media.thumbnailUrl(media.id)} alt="" loading="lazy" />
            ) : (
              <div className="media-card-placeholder">{media.mediaType === "video" ? "🎬" : "🖼"}</div>
            )}
            {badge && <span className="media-card-badge">{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
