import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SearchResultDto } from "@memorylane/shared";
import { api } from "../api/client";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResultDto[] | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    const res = await api.search(q.trim());
    setResults(res.items);
  };

  return (
    <div className="search-page">
      <form onSubmit={handleSubmit} className="search-form">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search folders, filenames, camera, lens..."
          autoFocus
        />
        <button type="submit">Search</button>
      </form>

      {results && (
        <ul className="search-results">
          {results.length === 0 && <li className="muted">No results.</li>}
          {results.map((r, i) =>
            r.type === "folder" && r.folder ? (
              <li key={`f-${r.folder.id}`}>
                <span className="result-type">Folder</span>
                <Link to={`/folder/${r.folder.id}`}>{r.folder.name}</Link>
              </li>
            ) : r.media ? (
              <li key={`m-${r.media.id}-${i}`}>
                <span className="result-type">{r.media.mediaType === "raw" ? "RAW" : r.media.mediaType === "video" ? "Video" : "Photo"}</span>
                <button className="link-button" onClick={() => navigate(`/folder/${r.media!.parentFolderId}`)}>
                  {r.media.filename}
                </button>
              </li>
            ) : null,
          )}
        </ul>
      )}
    </div>
  );
}
