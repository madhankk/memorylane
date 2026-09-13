import { useEffect, useRef, useState } from "react";
import type { ScanRootDto, SettingsDto, ScanStatusDto } from "@memorylane/shared";
import { api, ApiError } from "../api/client";
import { useTheme, THEMES, type Theme } from "../hooks/useTheme";

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

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  dusk: "Dusk",
  gallery: "Gallery",
};

// Small representative swatch colors per theme, just for the picker preview -
// not tied to the live CSS variables since the picker needs to show all four
// themes at once regardless of which one is currently active.
const THEME_SWATCHES: Record<Theme, { page: string; accent: string }> = {
  light: { page: "#ffffff", accent: "#2f6fed" },
  dark: { page: "#08090b", accent: "#8cb5ff" },
  dusk: { page: "#f1ede4", accent: "#426a73" },
  gallery: { page: "#f4f6f7", accent: "#315f8c" },
};

const inputClass = "rounded-lg border border-border bg-page px-3.5 py-2.5 text-ink outline-none focus:border-accent";
const buttonClass = "rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40";
const accentButtonClass = "rounded-lg bg-accent px-5 py-2.5 font-semibold text-page hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export default function SettingsPage() {
  const [scanRoots, setScanRoots] = useState<ScanRootDto[]>([]);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [status, setStatus] = useState<ScanStatusDto | null>(null);
  const [newPath, setNewPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { theme, setTheme } = useTheme();

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

  if (!settings) return <p className="text-sm text-muted">Loading...</p>;

  return (
    <div className="flex flex-col gap-10">
      <h1 className="font-serif text-2xl font-semibold text-ink">Settings</h1>

      <section>
        <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Appearance</h2>
        <div className="flex flex-wrap gap-3">
          {THEMES.map((value) => {
            const swatch = THEME_SWATCHES[value];
            const active = theme === value;
            return (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border bg-surface px-4 py-2.5 text-sm text-ink ${
                  active ? "border-accent" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={active}
                  onChange={() => setTheme(value)}
                  className="cursor-pointer accent-accent"
                />
                <span
                  className="h-4 w-4 rounded-full border border-border-strong"
                  style={{ background: swatch.page, boxShadow: `inset 0 0 0 5px ${swatch.accent}` }}
                  aria-hidden
                />
                {THEME_LABELS[value]}
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Scan Folders</h2>
        <p className="mb-3 text-sm text-muted">
          Add folders containing your photos and videos. MemoryLane never modifies, renames, or moves originals.
        </p>
        <div className="mb-3 flex gap-2">
          <input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder={"e.g. D:\\Photos or /mnt/photos"}
            className={`flex-1 ${inputClass}`}
          />
          <button onClick={addScanRoot} className={accentButtonClass}>
            Add Folder
          </button>
        </div>
        {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
        <ul className="flex flex-col gap-2">
          {scanRoots.map((root) => (
            <li
              key={root.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-3.5 py-2.5"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className={`truncate ${root.enabled ? "text-ink" : "text-muted"}`}>{root.path}</span>
                <span className="text-xs text-muted">{scanRootSummary(root)}</span>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => runScanNow(root.id)}
                  disabled={!root.enabled || status?.running}
                  title={!root.enabled ? "Enable this folder to scan it" : undefined}
                  className={buttonClass}
                >
                  {status?.running && status.currentRun?.scanRootId === root.id ? "Scanning..." : "Scan Now"}
                </button>
                <button onClick={() => toggleRoot(root)} className={buttonClass}>
                  {root.enabled ? "Disable" : "Enable"}
                </button>
                <button onClick={() => removeRoot(root)} className={buttonClass}>
                  Remove
                </button>
              </span>
            </li>
          ))}
          {scanRoots.length === 0 && <li className="text-sm text-muted">No folders added yet.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Scanning</h2>
        <div className="mb-4 flex items-center gap-2 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.scanScheduleEnabled}
              onChange={(e) => updateSchedule({ scanScheduleEnabled: e.target.checked })}
              className="accent-accent"
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
            className={`w-16 ${inputClass} disabled:opacity-40`}
          />
          days
        </div>

        <button onClick={() => runScanNow()} disabled={status?.running} className={accentButtonClass}>
          {status?.running ? "Scan running..." : "Run Scan Now (all folders)"}
        </button>

        {status && (
          <div className="mt-4 text-sm text-muted">
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
              <p className="text-muted">Last successful scan: {new Date(status.lastSuccessfulRun.startedAt).toLocaleString()}</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
