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
    <div>
      <form onSubmit={handleSubmit} className="mb-5 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search folders, filenames, camera, lens..."
          autoFocus
          className="flex-1 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent"
        />
        <button type="submit" className="rounded-lg bg-accent px-5 py-2.5 font-semibold text-page hover:opacity-90">
          Search
        </button>
      </form>

      {results && (
        <ul className="flex flex-col gap-2">
          {results.length === 0 && <li className="text-sm text-muted">No results.</li>}
          {results.map((r, i) =>
            r.type === "folder" && r.folder ? (
              <li key={`f-${r.folder.id}`} className="flex items-center gap-3">
                <span className="rounded bg-chip px-2 py-0.5 text-[11px] uppercase text-muted">Folder</span>
                <Link to={`/folder/${r.folder.id}`} className="text-ink hover:text-accent">
                  {r.folder.name}
                </Link>
              </li>
            ) : r.media ? (
              <li key={`m-${r.media.id}-${i}`} className="flex items-center gap-3">
                <span className="rounded bg-chip px-2 py-0.5 text-[11px] uppercase text-muted">
                  {r.media.mediaType === "raw" ? "RAW" : r.media.mediaType === "video" ? "Video" : "Photo"}
                </span>
                <button
                  className="text-ink underline hover:text-accent"
                  onClick={() => navigate(`/folder/${r.media!.parentFolderId}`)}
                >
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
