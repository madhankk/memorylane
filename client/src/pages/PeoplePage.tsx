import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PersonDto } from "@memorylane/shared";
import { api, ApiError } from "../api/client";
import AnalysisProgress from "../components/AnalysisProgress";

// Everyone the library knows about, unnamed "Person N"s first so the user
// sees what still needs a name. Off = a short explanation, not an empty grid.
export default function PeoplePage() {
  const [persons, setPersons] = useState<PersonDto[] | null>(null);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [off, setOff] = useState(false);
  const [finding, setFinding] = useState(false);

  const load = async (hidden: boolean) => {
    try {
      setPersons(await api.persons.list(hidden));
      setOff(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setOff(true);
      else throw err;
    }
  };

  useEffect(() => {
    void load(includeHidden);
  }, [includeHidden]);

  const findNow = async () => {
    setFinding(true);
    try {
      await api.persons.discover();
      await load(includeHidden);
    } finally {
      setFinding(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">People</h1>
          <p className="text-sm text-muted">{persons ? `${persons.length} ${persons.length === 1 ? "person" : "people"}` : ""}</p>
        </div>
        {!off && (
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} className="accent-accent" />
              Show hidden
            </label>
            <button onClick={() => void findNow()} disabled={finding} className="rounded-md border border-border px-3 py-1.5 text-ink hover:bg-hover disabled:opacity-40">
              {finding ? "Looking…" : "Find people now"}
            </button>
          </div>
        )}
      </div>

      {off && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm text-ink">
          <p className="font-medium">People is turned off.</p>
          <p className="mt-1 text-muted">
            Face grouping is opt-in because faces are personal data. Turn it on under{" "}
            <Link to="/settings" className="text-accent underline">Settings › People</Link> - everything stays on this machine and can be deleted in one click.
          </p>
        </div>
      )}

      {!off && (
        <div className="max-w-2xl">
          <AnalysisProgress only={["faces"]} />
        </div>
      )}

      {persons && persons.length === 0 && !off && (
        <p className="text-sm text-muted">No people yet - they appear once a few faces of the same person have been found. Use "Find people now" to group what's been found so far.</p>
      )}

      {persons && persons.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
          {persons.map((p) => (
            <Link key={p.id} to={`/people/${p.id}`} className="group flex flex-col items-center gap-2 rounded-lg p-2 hover:bg-hover">
              <div className="size-28 overflow-hidden rounded-full bg-media ring-1 ring-border">
                {p.coverFaceId && <img src={api.faces.cropUrl(p.coverFaceId)} alt="" className="size-full object-cover transition group-hover:scale-105" />}
              </div>
              <div className="text-center">
                <div className={`text-sm ${p.name ? "font-medium text-ink" : "text-muted italic"}`}>{p.displayName}</div>
                <div className="text-xs text-faint">{p.mediaCount} photo{p.mediaCount === 1 ? "" : "s"}{p.hidden ? " · hidden" : ""}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
