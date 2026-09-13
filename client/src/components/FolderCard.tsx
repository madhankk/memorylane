import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { FolderDto } from "@memorylane/shared";
import { api } from "../api/client";

// Mirrors life-archive-app's AlbumCard.tsx: cover image with a title overlaid
// in a bottom gradient, hover lift + zoom, and a footer row with the item
// count on one side and an arrow link on the other.
export default function FolderCard({ folder }: { folder: FolderDto }) {
  return (
    <Link
      to={`/folder/${folder.id}`}
      className="group block cursor-pointer overflow-hidden rounded-xl bg-surface ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-xl"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-media">
        {folder.thumbnailMediaId ? (
          <img
            src={api.media.thumbnailUrl(folder.thumbnailMediaId)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl opacity-40">📁</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="truncate font-serif text-2xl font-semibold text-white">{folder.name}</div>
        </div>
      </div>

      <div className="flex items-center justify-between p-4">
        <span className="text-sm text-muted">
          {folder.mediaCount > 0
            ? `${folder.mediaCount.toLocaleString()} items`
            : folder.childFolderCount > 0
              ? `${folder.childFolderCount.toLocaleString()} folders`
              : "Empty"}
        </span>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
          Open
          <ArrowRight size={15} strokeWidth={1.8} className="transition group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
