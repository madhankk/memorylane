import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ApplePhotosSyncStatusDto, PluginDto, PluginPlatformDto, ScanRootDto } from "@memorylane/shared";
import { api, ApiError } from "../api/client";
import { useConfirm } from "./ConfirmDialog";
import { isPluginActive } from "../utils/plugins";
import { CORE_UPDATE_REFRESH_EVENT } from "./CoreUpdateBanner";
import PluginInstallProgress from "./PluginInstallProgress";

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
  onToggle?: () => void;
  onPathChange: (path: string) => void;
  onAdd: (event: FormEvent) => void;
  onSync: (rootId: number) => void;
  detected?: { path: string; readable: boolean; reason?: string }[];
  onChooseDetected?: (path: string) => void;
}

export function ApplePhotosPluginPanel(props: PanelProps) {
  const { plugin, roots, statuses, helperStatus, libraryPath, busy, onToggle, onPathChange, onAdd, onSync } = props;
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
  const { confirm, notice } = useConfirm();
  const [plugin, setPlugin] = useState<PluginDto | null>(null);
  const [roots, setRoots] = useState<ScanRootDto[]>([]);
  const [statuses, setStatuses] = useState<Record<number, ApplePhotosSyncStatusDto>>({});
  const [helperStatus, setHelperStatus] = useState<string | null>(null);
  const [detected, setDetected] = useState<{ path: string; readable: boolean; reason?: string }[]>([]);
  const [libraryPath, setLibraryPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [platformPlugins, setPlatformPlugins] = useState<PluginPlatformDto[]>([]);
  const [pluginLogs, setPluginLogs] = useState<{id:string;lines:string[]}|null>(null);
  const [updateHistory,setUpdateHistory]=useState<Array<{pluginId:string;toVersion:string;status:string;at:string;error?:string}>>([]);
  const [coreVersion, setCoreVersion] = useState<string | null>(null);
  const [installingPlugin, setInstallingPlugin] = useState<{id:string;label:string}|null>(null);

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
    void refresh().catch((cause) => void notice({ title: "Could not load plugins", message: cause instanceof Error ? cause.message : "Something went wrong." }));
    const timer = window.setInterval(() => {
      if (plugin?.enabled) void refresh().catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, plugin?.enabled]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try { await api.scanRoots.create({ path: libraryPath.trim(), kind: "apple-photos" }); setLibraryPath(""); await refresh(); }
    catch (cause) { await notice({ title: "Could not add library", message: cause instanceof ApiError ? cause.message : "Something went wrong." }); }
    finally { setBusy(false); }
  };

  const sync = async (rootId: number) => {
    setBusy(true);
    try { await api.plugins.applePhotosSync(rootId); await refresh(); }
    catch (cause) { await notice({ title: "Could not start sync", message: cause instanceof ApiError ? cause.message : "Something went wrong." }); }
    finally { setBusy(false); }
  };

  const changePlatformPlugin = async (item: PluginPlatformDto) => {
    if (!item.version) return;
    setBusy(true);
    if (item.state === "available" || item.state === "update-available") setInstallingPlugin({ id: item.id, label: `${item.state === "available" ? "Installing" : "Updating"} ${item.name}…` });
    try {
      if (item.state === "update-available") await api.pluginPlatform.update(item.id, item.version);
      else if (item.state === "available") {
        await api.pluginPlatform.install(item.id, item.version);
        await api.pluginPlatform.setEnabled(item.id, true, item.version);
      } else await api.pluginPlatform.setEnabled(item.id, !isPluginActive(item), item.version);
      await refresh();
    } catch (cause) { await notice({ title: `Could not change ${item.name}`, message: cause instanceof ApiError ? cause.message : "Something went wrong." }); }
    finally { setBusy(false); setInstallingPlugin(null); }
  };

  const removePlatformPlugin = async (item: PluginPlatformDto) => {
    if (!item.version || item.required) return;
    const approved = await confirm({ title: `Remove ${item.name}?`, message: "The plugin can be downloaded again later. Indexed core data is preserved.", confirmLabel: "Remove plugin", danger: true });
    if (!approved) return;
    setBusy(true);
    try {
      await api.pluginPlatform.remove(item.id, item.version);
      await refresh();
      await notice({ title: "Plugin removed", message: `${item.name} was removed.` });
    } catch (cause) { await notice({ title: `Could not remove ${item.name}`, message: cause instanceof Error ? cause.message : "Something went wrong." }); }
    finally { setBusy(false); }
  };

  if (!plugin) return <p className="text-sm text-muted">Loading plugins…</p>;
  // "available" is the only state a plugin can be in before it's ever been
  // installed - everything else (disabled/installed/ready/failed/
  // update-available, and the rare case of an installed plugin that's gone
  // incompatible after a core upgrade) means it's on disk in some form.
  // Required plugins are always installed by the time this loads (they're
  // auto-installed at boot), so they land in the same "Installed" group as
  // any optional plugin the user has added - required-vs-optional is still
  // visible per row, just not worth its own separate heading.
  // Required-first within Installed - otherwise required plugins (always
  // present, same as core) would be scattered alphabetically among whatever
  // optional features happen to be installed, instead of reading as "the
  // foundation, then what you've added".
  const installedPlugins = platformPlugins
    .filter((item) => item.state !== "available")
    .sort((a, b) => Number(b.required) - Number(a.required));
  const availablePlugins = platformPlugins.filter((item) => item.state === "available");
  const renderPlugin = (item: PluginPlatformDto) => <section key={item.id} className="rounded-xl border border-border p-5"><div className="flex flex-wrap items-center justify-between gap-4">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-ink">{item.name}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.required ? "bg-accent/15 text-accent" : "bg-chip text-muted"}`}>
          {item.required ? "Required" : "Optional"}
        </span>
      </div>
      {item.description && <p className="mt-1 text-sm text-muted">{item.description}</p>}
      <p className="mt-1 text-xs text-muted">
        {item.version ? `v${item.version} · ` : ""}{item.state}
        {item.dependsOn.length > 0 && ` · Requires ${item.dependsOn.join(", ")}`}
      </p>
      {item.error && <p className="mt-1 text-xs text-amber-600">{item.error}</p>}
    </div>
    <div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => void api.pluginPlatform.logs(item.id).then(result=>setPluginLogs({id:item.id,lines:result.lines})).catch(()=>setPluginLogs({id:item.id,lines:["Logs unavailable"]}))}>Logs</button>
      {/* Required plugins keep Update (a version bump, not a user turning a
          core feature off) but never Enable/Disable or Remove - matched by
          the server-side guards on the same actions. */}
      {(!item.required || item.state === "update-available") && <button type="button" className={buttonClass} disabled={busy || item.state === "incompatible" || !item.version} onClick={() => void changePlatformPlugin(item)}>
        {item.state === "available" ? "Install" : item.state === "update-available" ? "Update" : isPluginActive(item) ? "Disable" : "Enable"}
      </button>}
      {!item.required && item.state !== "available" && <button type="button" className={buttonClass} disabled={busy} onClick={() => void removePlatformPlugin(item)}>Remove</button>}</div></div>
    {installingPlugin?.id === item.id && <PluginInstallProgress label={installingPlugin.label} />}
  </section>;
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4"><p className="text-sm text-muted">Core and plugin updates are checked daily. Plugin updates roll back when startup health checks fail.</p><button type="button" className={buttonClass} disabled={busy} onClick={()=>{setBusy(true);void Promise.all([api.pluginPlatform.checkUpdates(),api.coreUpdate.check()]).then(()=>{window.dispatchEvent(new Event(CORE_UPDATE_REFRESH_EVENT));return refresh();}).catch(cause=>notice({title:"Update check failed",message:cause instanceof Error?cause.message:"Something went wrong."})).finally(()=>setBusy(false));}}>Check for updates</button></div>
    <section className="space-y-3"><h2 className="font-serif text-lg font-semibold text-ink">Core</h2><div className="rounded-xl border border-border p-5"><h3 className="font-semibold text-ink">MemoryLane Core</h3><p className="text-sm text-muted">Built in · v{coreVersion ?? "…"} · running</p></div></section>
    <section className="space-y-3"><div><h2 className="font-serif text-lg font-semibold text-ink">Installed</h2><p className="text-sm text-muted">Required components plus any optional features you've added.</p></div>{installedPlugins.map(renderPlugin)}</section>
    <section className="space-y-3">
      <div><h2 className="font-serif text-lg font-semibold text-ink">Available to install</h2><p className="text-sm text-muted">Install only the features you want.</p></div>
      {availablePlugins.length > 0 ? availablePlugins.map(renderPlugin) : <p className="text-sm text-muted">Nothing else available for this platform right now.</p>}
    </section>
    {pluginLogs&&<section className="rounded-xl border border-border p-4"><div className="mb-2 flex justify-between"><h3 className="font-medium">Recent plugin output</h3><button className={buttonClass} onClick={()=>setPluginLogs(null)}>Close</button></div><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted">{pluginLogs.lines.join("\n")||"No output recorded."}</pre></section>}
    {updateHistory.length>0&&<details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-medium">Update history</summary><div className="mt-3 space-y-2 text-xs text-muted">{updateHistory.map((item,index)=><p key={`${item.at}-${index}`}>{new Date(item.at).toLocaleString()} · {item.pluginId} → {item.toVersion} · {item.status}{item.error?` · ${item.error}`:""}</p>)}</div></details>}
    <ApplePhotosPluginPanel plugin={plugin} roots={roots} statuses={statuses} helperStatus={helperStatus}
      libraryPath={libraryPath} busy={busy} onPathChange={setLibraryPath}
      onAdd={(event) => { void add(event); }} onSync={(id) => { void sync(id); }} detected={detected} onChooseDetected={setLibraryPath} />
  </div>;
}
