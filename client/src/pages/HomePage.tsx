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
    <div className="home-page">
      <section className="hero">
        <h1>MemoryLane</h1>
        <p className="hero-tagline">Reconnect with the memories already sitting in your photo archive.</p>
        <button className="surprise-button" onClick={() => navigate("/surprise")}>
          Surprise Me
        </button>
      </section>

      <section className="memory-tiles">
        <button className="memory-tile" disabled title="Coming soon">
          On This Day
        </button>
        <button className="memory-tile" disabled title="Coming soon">
          Years Ago
        </button>
        <button className="memory-tile" onClick={randomFolder} disabled={!folders?.length}>
          Random Folder
        </button>
        <button className="memory-tile" disabled title="Coming soon">
          Forgotten Photos
        </button>
      </section>

      <section>
        <h2>Your Library</h2>
        {folders === null && <p className="muted">Loading...</p>}
        {folders && folders.length === 0 && (
          <p className="muted">
            No photo folders configured yet. Head to Settings to add a folder to scan.
          </p>
        )}
        {folders && folders.length > 0 && (
          <div className="folder-grid">
            {folders.map((f) => (
              <FolderCard key={f.id} folder={f} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
