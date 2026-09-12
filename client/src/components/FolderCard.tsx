import { Link } from "react-router-dom";
import type { FolderDto } from "@memorylane/shared";
import { api } from "../api/client";

export default function FolderCard({ folder }: { folder: FolderDto }) {
  return (
    <Link to={`/folder/${folder.id}`} className="folder-card">
      <div className="folder-card-thumb">
        {folder.thumbnailMediaId ? (
          <img src={api.media.thumbnailUrl(folder.thumbnailMediaId)} alt="" loading="lazy" />
        ) : (
          <div className="folder-card-placeholder">📁</div>
        )}
      </div>
      <div className="folder-card-meta">
        <div className="folder-card-name">{folder.name}</div>
        <div className="folder-card-counts">
          {folder.childFolderCount > 0 && <span>{folder.childFolderCount} folders</span>}
          {folder.mediaCount > 0 && <span>{folder.mediaCount} items</span>}
        </div>
      </div>
    </Link>
  );
}
