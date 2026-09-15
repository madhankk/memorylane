import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { MediaDto, SearchMode, SearchResultDto } from "@memorylane/shared";
import { api, ApiError } from "../api/client";
import MediaGrid from "../components/MediaGrid";
import Viewer from "../components/Viewer";

const MODES: { value: SearchMode; label: string; placeholder: string }[] = [
  { value: "text", label: "Names", placeholder: "Search folders, filenames, camera, lens..." },
  { value: "semantic", label: "Describe it (AI)", placeholder: "a bird taking off from water, a red car at night, snow on mountains..." },
];

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<SearchMode>("text");
  const [results, setResults] = useState<SearchResultDto[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setProblem(null);
    try {
      const res = await api.search(q.trim(), 0, 60, mode);
      setResults(res.items);
    } catch (err) {
      setResults(null);
      setProblem(err instanceof ApiError && err.status === 503 ? err.message : "Search failed");
    }
  };

  const semanticMedia: MediaDto[] = mode === "semantic" ? (results ?? []).flatMap((r) => (r.media ? [r.media] : [])) : [];
  const captions = Object.fromEntries((results ?? []).filter((r) => r.media && r.score != null).map((r) => [r.media!.id, `${Math.round((r.score ?? 0) * 100)}%`]));

  return (
    <div>
      <div className="mb-3 flex items-center gap-1 rounded-md border border-border p-0.5 text-sm w-fit" role="group" aria-label="Search mode">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => {
              setMode(m.value);
              setResults(null);
              setProblem(null);
            }}
            aria-pressed={mode === m.value}
            className={`rounded px-3 py-1 transition-colors ${mode === m.value ? "bg-accent text-page" : "text-muted hover:bg-hover hover:text-ink"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="mb-5 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={MODES.find((m) => m.value === mode)?.placeholder}
          autoFocus
          className="flex-1 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent"
        />
        <button type="submit" className="rounded-lg bg-accent px-5 py-2.5 font-semibold text-page hover:opacity-90">
          Search
        </button>
      </form>

      {problem && (
        <div className="mb-4 rounded-lg border border-border bg-surface p-4 text-sm text-ink">
          <p className="font-medium">AI search isn't available right now.</p>
          <p className="mt-1 text-muted">
            {problem} - see{" "}
            <Link to="/settings" className="text-accent underline">
              Settings › AI
            </Link>
            .
          </p>
        </div>
      )}

      {mode === "semantic" && results && (
        <>
          {semanticMedia.length === 0 && <p className="text-sm text-muted">Nothing analysed yet matches that description.</p>}
          {semanticMedia.length > 0 && <MediaGrid items={semanticMedia} onOpen={setViewerIndex} captions={captions} />}
          {viewerIndex !== null && <Viewer items={semanticMedia} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />}
        </>
      )}

      {mode === "text" && results && (
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
