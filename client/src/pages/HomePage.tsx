import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FolderDto } from "@memorylane/shared";
import { api } from "../api/client";
import FolderCard from "../components/FolderCard";

export default function HomePage() {
  const [folders, setFolders] = useState<FolderDto[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void api.folders.listTop().then(setFolders);
  }, []);

  const randomFolder = () => {
    if (folders && folders.length > 0) {
      const pick = folders[Math.floor(Math.random() * folders.length)];
      navigate(`/folder/${pick.id}`);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <section className="py-10 text-center">
        <h1 className="font-serif text-[40px] font-semibold tracking-tight text-ink">MemoryLane</h1>
        <p className="mt-2 text-base text-muted">Reconnect with the memories already sitting in your photo archive.</p>
        <button
          className="mt-6 rounded-full bg-accent px-10 py-4 text-lg font-bold text-page shadow-hero transition-opacity hover:opacity-90"
          onClick={() => {
            // Requested synchronously inside the click handler - browsers only grant
            // fullscreen in direct response to a user gesture, and that gesture context
            // is gone by the time the Surprise Me route finishes fetching photos.
            document.documentElement.requestFullscreen?.().catch(() => {});
            navigate("/surprise");
          }}
        >
          Surprise Me
        </button>
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <button
          disabled
          title="Coming soon"
          className="rounded-xl border border-border bg-surface p-5 text-left text-sm text-ink shadow-card disabled:cursor-not-allowed disabled:opacity-40"
        >
          On This Day
        </button>
        <button
          disabled
          title="Coming soon"
          className="rounded-xl border border-border bg-surface p-5 text-left text-sm text-ink shadow-card disabled:cursor-not-allowed disabled:opacity-40"
        >
          Years Ago
        </button>
        <button
          onClick={randomFolder}
          disabled={!folders?.length}
          className="rounded-xl border border-border bg-surface p-5 text-left text-sm text-ink shadow-card transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Random Folder
        </button>
        <button
          disabled
          title="Coming soon"
          className="rounded-xl border border-border bg-surface p-5 text-left text-sm text-ink shadow-card disabled:cursor-not-allowed disabled:opacity-40"
        >
          Forgotten Photos
        </button>
      </section>

      <section>
        <h2 className="mb-4 font-serif text-2xl font-semibold text-ink">Your Library</h2>
        {folders === null && <p className="text-sm text-muted">Loading...</p>}
        {folders && folders.length === 0 && (
          <p className="text-sm text-muted">No photo folders configured yet. Head to Settings to add a folder to scan.</p>
        )}
        {folders && folders.length > 0 && (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
            {folders.map((f) => (
              <FolderCard key={f.id} folder={f} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
