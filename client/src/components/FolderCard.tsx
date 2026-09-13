import { Link } from "react-router-dom";
import type { FolderDto } from "@memorylane/shared";
import { api } from "../api/client";

export default function FolderCard({ folder }: { folder: FolderDto }) {
  return (
    <Link
      to={`/folder/${folder.id}`}
      className="block overflow-hidden rounded-xl border border-border bg-surface text-ink shadow-card transition-shadow hover:shadow-card-hover"
    >
      <div className="flex aspect-[4/3] items-center justify-center bg-media">
        {folder.thumbnailMediaId ? (
          <img
            src={api.media.thumbnailUrl(folder.thumbnailMediaId)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-3xl opacity-40">📁</div>
        )}
      </div>
      <div className="px-3 py-2.5">
        <div className="mb-1 truncate font-semibold text-ink">{folder.name}</div>
        <div className="flex gap-2.5 text-xs text-muted">
          {folder.childFolderCount > 0 && <span>{folder.childFolderCount} folders</span>}
          {folder.mediaCount > 0 && <span>{folder.mediaCount} items</span>}
        </div>
      </div>
    </Link>
  );
}
