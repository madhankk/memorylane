import { useEffect, useRef, useState } from "react";
import type { ScanRootDto, SettingsDto, ScanStatusDto } from "@memorylane/shared";
import { api, ApiError } from "../api/client";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function scanRootSummary(root: ScanRootDto): string {
  const { stats } = root;
  if (stats.mediaCount === 0) return "No media indexed yet";

  const parts: string[] = [];
  if (stats.photoCount) parts.push(`${stats.photoCount.toLocaleString()} photos`);
  if (stats.rawCount) parts.push(`${stats.rawCount.toLocaleString()} RAW`);
  if (stats.videoCount) parts.push(`${stats.videoCount.toLocaleString()} videos`);
  parts.push(`${stats.folderCount.toLocaleString()} folders`);
  parts.push(formatBytes(stats.totalSizeBytes));

  let summary = parts.join(" · ");
  if (stats.pendingThumbnails) summary += ` · ${stats.pendingThumbnails.toLocaleString()} pending`;
  if (stats.failedThumbnails) summary += ` · ${stats.failedThumbnails.toLocaleString()} failed`;
  return summary;
}

export default function SettingsPage() {
  const [scanRoots, setScanRoots] = useState<ScanRootDto[]>([]);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [status, setStatus] = useState<ScanStatusDto | null>(null);
  const [newPath, setNewPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = async () => {
    const [roots, s, st] = await Promise.all([api.scanRoots.list(), api.settings.get(), api.scans.status()]);
    setScanRoots(roots);
    setSettings(s);
    setStatus(st);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (status?.running && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const st = await api.scans.status();
        setStatus(st);
        if (!st.running && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          // Scan just finished - refresh per-folder stats now that they've changed.
          setScanRoots(await api.scanRoots.list());
        }
      }, 2000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.running]);

  const addScanRoot = async () => {
    if (!newPath.trim()) return;
    setError(null);
    try {
      const root = await api.scanRoots.create({ path: newPath.trim() });
      setScanRoots((prev) => [...prev, root]);
      setNewPath("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add folder");
    }
  };

  const toggleRoot = async (root: ScanRootDto) => {
    const updated = await api.scanRoots.update(root.id, { enabled: !root.enabled });
    setScanRoots((prev) => prev.map((r) => (r.id === root.id ? updated : r)));
  };

  const removeRoot = async (root: ScanRootDto) => {
    if (!confirm(`Remove "${root.path}" from MemoryLane? Original files are never touched - this only removes MemoryLane's index for this folder.`)) return;
    await api.scanRoots.remove(root.id);
    setScanRoots((prev) => prev.filter((r) => r.id !== root.id));
  };

  const runScanNow = async (scanRootId?: number) => {
    setError(null);
    try {
      await api.scans.run(scanRootId);
      const st = await api.scans.status();
      setStatus(st);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start scan");
    }
  };

  const scanningRootPath =
    status?.running && status.currentRun?.scanRootId != null
      ? scanRoots.find((r) => r.id === status.currentRun!.scanRootId)?.path
      : null;

  const updateSchedule = async (patch: Partial<SettingsDto>) => {
    const updated = await api.settings.update(patch);
    setSettings(updated);
  };

  if (!settings) return <p className="muted">Loading...</p>;

  return (
    <div className="settings-page">
      <h1>Settings</h1>

      <section>
        <h2>Scan Folders</h2>
        <p className="muted">
          Add folders containing your photos and videos. MemoryLane never modifies, renames, or moves originals.
        </p>
        <div className="scan-root-add">
          <input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder={"e.g. D:\\Photos or /mnt/photos"}
          />
          <button onClick={addScanRoot}>Add Folder</button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <ul className="scan-root-list">
          {scanRoots.map((root) => (
            <li key={root.id}>
              <div className="scan-root-info">
                <span className={root.enabled ? "" : "muted"}>{root.path}</span>
                <span className="scan-root-stats muted">{scanRootSummary(root)}</span>
              </div>
              <span>
                <button
                  onClick={() => runScanNow(root.id)}
                  disabled={!root.enabled || status?.running}
                  title={!root.enabled ? "Enable this folder to scan it" : undefined}
                >
                  {status?.running && status.currentRun?.scanRootId === root.id ? "Scanning..." : "Scan Now"}
                </button>
                <button onClick={() => toggleRoot(root)}>{root.enabled ? "Disable" : "Enable"}</button>
                <button onClick={() => removeRoot(root)}>Remove</button>
              </span>
            </li>
          ))}
          {scanRoots.length === 0 && <li className="muted">No folders added yet.</li>}
        </ul>
      </section>

      <section>
        <h2>Scanning</h2>
        <div className="scan-schedule">
          <label>
            <input
              type="checkbox"
              checked={settings.scanScheduleEnabled}
              onChange={(e) => updateSchedule({ scanScheduleEnabled: e.target.checked })}
            />
            Scan automatically every
          </label>
          <input
            type="number"
            min={1}
            max={365}
            value={settings.scanIntervalDays ?? 7}
            onChange={(e) => updateSchedule({ scanIntervalDays: Number(e.target.value) })}
            disabled={!settings.scanScheduleEnabled}
            style={{ width: 60 }}
          />
          days
        </div>

        <button onClick={() => runScanNow()} disabled={status?.running} className="run-scan-button">
          {status?.running ? "Scan running..." : "Run Scan Now (all folders)"}
        </button>

        {status && (
          <div className="scan-status">
            {status.currentRun && status.running && (
              <p>
                Scanning{scanningRootPath ? ` "${scanningRootPath}"` : " all folders"}:{" "}
                {status.currentRun.filesScanned} files scanned, {status.currentRun.filesNew} new,{" "}
                {status.currentRun.errorCount} errors so far.
              </p>
            )}
            {status.lastRun && !status.running && (
              <p>
                Last scan: {new Date(status.lastRun.startedAt).toLocaleString()} - {status.lastRun.status} -{" "}
                {status.lastRun.filesScanned} scanned, {status.lastRun.filesNew} new, {status.lastRun.filesChanged}{" "}
                changed, {status.lastRun.filesRemoved} removed, {status.lastRun.errorCount} errors.
              </p>
            )}
            {status.lastSuccessfulRun && (
              <p className="muted">Last successful scan: {new Date(status.lastSuccessfulRun.startedAt).toLocaleString()}</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
