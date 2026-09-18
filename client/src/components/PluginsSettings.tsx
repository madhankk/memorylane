import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ApplePhotosSyncStatusDto, PluginDto, PluginPlatformDto, ScanRootDto } from "@memorylane/shared";
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
  onToggle?: () => void;
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
        {!plugin.available ? <span className="text-sm text-muted">Unavailable on this platform</span> : props.onToggle ? (
          <button type="button" className={buttonClass} disabled={busy} onClick={onToggle}>
            {plugin.enabled ? "Disable Apple Photos" : "Enable Apple Photos"}
          </button>
        ) : null}
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {plugin.enabled && (
        <div className="space-y-5 border-t border-border pt-5">
          <div className="space-y-1 text-sm text-muted">
            <p>Plugin service: {helperStatus ?? "Checking…"}. MemoryLane starts and monitors it automatically.</p>
            <p>If the library cannot be read, grant Full Disk Access to MemoryLane in System Settings, then retry.</p>
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
  const [platformPlugins, setPlatformPlugins] = useState<PluginPlatformDto[]>([]);
  const [pluginLogs, setPluginLogs] = useState<{id:string;lines:string[]}|null>(null);
  const [updateHistory,setUpdateHistory]=useState<Array<{pluginId:string;toVersion:string;status:string;at:string;error?:string}>>([]);
  const [coreVersion, setCoreVersion] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [plugins, generic, updates, versionInfo] = await Promise.all([api.plugins.list(), api.pluginPlatform.list(), api.pluginPlatform.updates(), api.settings.version()]);
    setUpdateHistory(updates.history.slice(-10).reverse());
    setPlatformPlugins(generic.filter((item) => item.id !== "com.memorylane.apple-photos"));
    setCoreVersion(versionInfo.version);
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

  const changePlatformPlugin = async (item: PluginPlatformDto) => {
    if (!item.version) return;
    setBusy(true); setError(null);
    try {
      if (item.state === "update-available") await api.pluginPlatform.update(item.id, item.version);
      else if (item.state === "available") {
        await api.pluginPlatform.install(item.id, item.version);
        await api.pluginPlatform.setEnabled(item.id, true, item.version);
      } else await api.pluginPlatform.setEnabled(item.id, item.state !== "ready", item.version);
      await refresh();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not change plugin state"); }
    finally { setBusy(false); }
  };

  const removePlatformPlugin = async (item: PluginPlatformDto) => {
    if (!item.version || item.required) return;
    const approved = await confirm({ title: `Remove ${item.name}?`, message: "The plugin can be downloaded again later. Indexed core data is preserved.", confirmLabel: "Remove plugin" });
    if (!approved) return;
    setBusy(true); setError(null);
    try { await api.pluginPlatform.remove(item.id, item.version); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove plugin"); }
    finally { setBusy(false); }
  };

  if (!plugin) return <p className="text-sm text-muted">Loading plugins…</p>;
  const requiredPlugins = platformPlugins.filter((item) => item.required);
  const optionalPlugins = platformPlugins.filter((item) => !item.required);
  const renderPlugin = (item: PluginPlatformDto) => <section key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-5">
    <div className="min-w-0"><h3 className="font-semibold text-ink">{item.name}</h3><p className="text-sm text-muted">{item.required ? "Required" : "Optional"} · {item.version ? `v${item.version} · ` : ""}{item.state}</p>{item.error && <p className="mt-1 text-xs text-amber-600">{item.error}</p>}</div>
    <div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => void api.pluginPlatform.logs(item.id).then(result=>setPluginLogs({id:item.id,lines:result.lines})).catch(()=>setPluginLogs({id:item.id,lines:["Logs unavailable"]}))}>Logs</button><button type="button" className={buttonClass} disabled={busy || item.state === "incompatible" || !item.version} onClick={() => void changePlatformPlugin(item)}>
      {item.state === "available" ? "Install" : item.state === "update-available" ? "Update" : item.state === "ready" ? "Disable" : "Enable"}
    </button>{!item.required && item.state === "disabled" && <button type="button" className={buttonClass} disabled={busy} onClick={() => void removePlatformPlugin(item)}>Remove</button>}</div>
  </section>;
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4"><p className="text-sm text-muted">Updates are checked daily and rolled back when startup health checks fail.</p><button type="button" className={buttonClass} disabled={busy} onClick={()=>{setBusy(true);void api.pluginPlatform.checkUpdates().then(()=>refresh()).catch(cause=>setError(cause instanceof Error?cause.message:"Update check failed")).finally(()=>setBusy(false));}}>Check for updates</button></div>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    <section className="space-y-3"><h2 className="font-serif text-lg font-semibold text-ink">Core</h2><div className="rounded-xl border border-border p-5"><h3 className="font-semibold text-ink">MemoryLane Core</h3><p className="text-sm text-muted">Built in · v{coreVersion ?? "…"} · running</p></div></section>
    <section className="space-y-3"><div><h2 className="font-serif text-lg font-semibold text-ink">Required plugins</h2><p className="text-sm text-muted">Needed for complete metadata, RAW, and video support.</p></div>{requiredPlugins.map(renderPlugin)}</section>
    <section className="space-y-3"><div><h2 className="font-serif text-lg font-semibold text-ink">Optional plugins</h2><p className="text-sm text-muted">Install only the features you want.</p></div>{optionalPlugins.map(renderPlugin)}</section>
    {pluginLogs&&<section className="rounded-xl border border-border p-4"><div className="mb-2 flex justify-between"><h3 className="font-medium">Recent plugin output</h3><button className={buttonClass} onClick={()=>setPluginLogs(null)}>Close</button></div><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted">{pluginLogs.lines.join("\n")||"No output recorded."}</pre></section>}
    {updateHistory.length>0&&<details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-medium">Update history</summary><div className="mt-3 space-y-2 text-xs text-muted">{updateHistory.map((item,index)=><p key={`${item.at}-${index}`}>{new Date(item.at).toLocaleString()} · {item.pluginId} → {item.toVersion} · {item.status}{item.error?` · ${item.error}`:""}</p>)}</div></details>}
    <ApplePhotosPluginPanel plugin={plugin} roots={roots} statuses={statuses} helperStatus={helperStatus}
      libraryPath={libraryPath} busy={busy} error={error} onPathChange={setLibraryPath}
      onAdd={(event) => { void add(event); }} onSync={(id) => { void sync(id); }} detected={detected} onChooseDetected={setLibraryPath} />
  </div>;
}
