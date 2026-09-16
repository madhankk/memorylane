import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ApplePhotosSyncStatusDto, PluginDto, ScanRootDto } from "@memorylane/shared";
import { api, ApiError } from "../api/client";
import { useConfirm } from "./ConfirmDialog";

const buttonClass = "rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-hover disabled:opacity-40";

function syncSummary(status: ApplePhotosSyncStatusDto | undefined): string {
  if (!status) return "Not synced";
  if (status.status === "running" && status.total === 0) {
    const started = status.startedAt ? Date.parse(status.startedAt) : NaN;
    const elapsed = Number.isFinite(started) ? ` · ${Math.max(0, Math.floor((Date.now() - started) / 1000))}s elapsed` : "";
    return `Preparing Photos catalog${elapsed}`;
  }
  return `${status.processed.toLocaleString()} / ${status.total.toLocaleString()} · ${status.status}${status.failed ? ` · ${status.failed.toLocaleString()} skipped` : ""}`;
}

interface PanelProps {
  plugin: PluginDto;
  roots: ScanRootDto[];
  statuses: Record<number, ApplePhotosSyncStatusDto>;
  helperStatus: string | null;
  libraryPath: string;
  busy: boolean;
  error: string | null;
  onToggle: () => void;
  onPathChange: (path: string) => void;
  onAdd: (event: FormEvent) => void;
  onSync: (rootId: number) => void;
  detected?: { path: string; readable: boolean; reason?: string }[];
  onChooseDetected?: (path: string) => void;
}

export function ApplePhotosPluginPanel(props: PanelProps) {
  const { plugin, roots, statuses, helperStatus, libraryPath, busy, error, onToggle, onPathChange, onAdd, onSync } = props;
  return (
    <section className="space-y-5 rounded-xl border border-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">Apple Photos</h2>
          <p className="text-sm text-muted">Read-only import from a local macOS Photos library. Off by default.</p>
        </div>
        {!plugin.available ? <span className="text-sm text-muted">Unavailable on this platform</span> : (
          <button type="button" className={buttonClass} disabled={busy} onClick={onToggle}>
            {plugin.enabled ? "Disable Apple Photos" : "Enable Apple Photos"}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {plugin.enabled && (
        <div className="space-y-5 border-t border-border pt-5">
          <div className="space-y-1 text-sm text-muted">
            <p>Dedicated helper: {helperStatus ?? "Checking…"}. Start it in a separate terminal with <code className="text-ink">npm run photos-helper</code>.</p>
            <p>To stop the helper, press Ctrl+C in that terminal. MemoryLane never starts the AI sidecar for this plugin.</p>
            <p>If the library cannot be read, grant Full Disk Access to the terminal or app running both MemoryLane and the helper, then retry.</p>
          </div>
          <form onSubmit={onAdd} className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="apple-photos-library-path">Photos library path</label>
            <input id="apple-photos-library-path" value={libraryPath} onChange={(e) => onPathChange(e.target.value)}
              placeholder="/Users/you/Pictures/Photos Library.photoslibrary" className="min-w-64 flex-1 rounded-md border border-border bg-page px-3 py-2 text-sm text-ink" />
            <button type="submit" className={buttonClass} disabled={busy || !libraryPath.trim()}>Add library</button>
          </form>
          {(props.detected ?? []).filter((item) => !roots.some((root) => root.path === item.path)).map((item) => (
            <div key={item.path} className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className="break-all">Detected: {item.path}</span>
              {item.readable ? <button type="button" className={buttonClass} onClick={() => props.onChooseDetected?.(item.path)}>Use this path</button>
                : <span className="text-red-500">{item.reason}</span>}
            </div>
          ))}
          <div className="space-y-3">
            {roots.length === 0 && <p className="text-sm text-muted">No Photos libraries added yet.</p>}
            {roots.map((root) => {
              const status = statuses[root.id];
              return <div key={root.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="break-all text-sm text-ink">{root.path}</p>
                  <p className="text-xs text-muted">{root.stats.mediaCount.toLocaleString()} indexed · {syncSummary(status)}</p>
                  {status && <p className="text-xs text-muted">{status.previewOnly.toLocaleString()} preview-only · {status.unavailable.toLocaleString()} unavailable</p>}
                  {status?.error && <p className="text-xs text-red-500">Previous sync error: {status.error}</p>}
                </div>
                <button type="button" className={buttonClass} disabled={busy || !root.enabled || status?.status === "running"} onClick={() => onSync(root.id)}>Sync now</button>
              </div>;
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export default function PluginsSettings() {
  const { confirm } = useConfirm();
  const [plugin, setPlugin] = useState<PluginDto | null>(null);
  const [roots, setRoots] = useState<ScanRootDto[]>([]);
  const [statuses, setStatuses] = useState<Record<number, ApplePhotosSyncStatusDto>>({});
  const [helperStatus, setHelperStatus] = useState<string | null>(null);
  const [detected, setDetected] = useState<{ path: string; readable: boolean; reason?: string }[]>([]);
  const [libraryPath, setLibraryPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const plugins = await api.plugins.list();
    const next = plugins.find((item) => item.id === "apple-photos") ?? null;
    setPlugin(next);
    if (!next?.enabled) { setRoots([]); setStatuses({}); setHelperStatus(null); setDetected([]); return; }
    setDetected(await api.plugins.detectApplePhotosLibraries());
    const allRoots = await api.scanRoots.list();
    const appleRoots = allRoots.filter((root) => root.kind === "apple-photos");
    setRoots(appleRoots);
    const checks = await Promise.all(appleRoots.map(async (root) => [root.id, await api.plugins.applePhotosSyncStatus(root.id)] as const));
    setStatuses(Object.fromEntries(checks));
    try { await api.plugins.applePhotosHealth(); setHelperStatus("ready"); }
    catch (cause) { setHelperStatus(cause instanceof Error ? cause.message : "not running"); }
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load plugins"));
    const timer = window.setInterval(() => {
      if (plugin?.enabled) void refresh().catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh, plugin?.enabled]);

  const toggle = async () => {
    if (!plugin) return;
    if (plugin.enabled) {
      const approved = await confirm({ title: "Disable Apple Photos?", message: "Imported Apple Photos will disappear from MemoryLane until you re-enable the plugin. The index and original Photos library are kept.", confirmLabel: "Disable plugin" });
      if (!approved) return;
    }
    setBusy(true); setError(null);
    try {
      await api.plugins.setApplePhotosEnabled(!plugin.enabled);
      if (plugin.enabled) window.location.reload();
      else await refresh();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not change plugin state"); }
    finally { setBusy(false); }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try { await api.scanRoots.create({ path: libraryPath.trim(), kind: "apple-photos" }); setLibraryPath(""); await refresh(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not add library"); }
    finally { setBusy(false); }
  };

  const sync = async (rootId: number) => {
    setBusy(true); setError(null);
    try { await api.plugins.applePhotosSync(rootId); await refresh(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not start sync"); }
    finally { setBusy(false); }
  };

  if (!plugin) return <p className="text-sm text-muted">Loading plugins…</p>;
  return <ApplePhotosPluginPanel plugin={plugin} roots={roots} statuses={statuses} helperStatus={helperStatus}
    libraryPath={libraryPath} busy={busy} error={error} onToggle={() => { void toggle(); }} onPathChange={setLibraryPath}
    onAdd={(event) => { void add(event); }} onSync={(id) => { void sync(id); }} detected={detected} onChooseDetected={setLibraryPath} />;
}
