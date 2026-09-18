import fs from "node:fs";
import path from "node:path";
import {
  checkPluginCompatibility,
  coreVersionSatisfies,
  PluginManifestSchema,
  type PluginCatalog,
  type PluginCatalogRelease,
  type PluginInventoryItem,
  type PluginManifest,
  type PluginPlatform,
} from "@memorylane/plugin-sdk";
import type { KeyLike } from "node:crypto";
import { PluginInstaller, type PluginInstallOptions } from "./installer.js";
import { pluginVersionDir, type PluginPlatformPaths } from "./paths.js";
import { PluginServiceSupervisor } from "./service-supervisor.js";
import { PluginModuleHost } from "./module-host-client.js";
import { PluginStateStore } from "./state-store.js";

export interface PluginManagerOptions {
  paths: PluginPlatformPaths;
  dataDir: string;
  coreVersion: string;
  platform: PluginPlatform;
  publicKey: KeyLike;
  onOutput?: (pluginId: string, stream: "stdout" | "stderr", text: string) => void;
}

const FIRST_PARTY_PLUGINS = [
  { id: "com.memorylane.metadata-raw", name: "Metadata & RAW", required: true, capabilities: ["media.metadata", "media.raw-preview"] },
  { id: "com.memorylane.video-tools", name: "Video Tools", required: true, capabilities: ["video.probe", "video.poster", "video.transcode"] },
  { id: "com.memorylane.ai-runtime", name: "AI Runtime", required: false, capabilities: ["ai.image-embedding", "ai.text-embedding", "people.faces", "vector.store"] },
  { id: "com.memorylane.ai-search", name: "AI Search & Similar", required: false, capabilities: ["ai.image-embedding", "ai.text-embedding"] },
  { id: "com.memorylane.people", name: "People", required: false, capabilities: ["people.faces"] },
] as const;

export class PluginManager {
  readonly state: PluginStateStore;
  readonly installer: PluginInstaller;
  readonly supervisor: PluginServiceSupervisor;
  readonly moduleHost: PluginModuleHost;
  private catalog: PluginCatalog | null = null;
  private readonly output = new Map<string, string[]>();
  private shuttingDown = false;
  private readonly operations = new Set<string>();

  constructor(private readonly options: PluginManagerOptions) {
    this.state = new PluginStateStore(options.paths);
    this.installer = new PluginInstaller(options.paths, this.state);
    this.supervisor = new PluginServiceSupervisor({
      coreVersion: options.coreVersion,
      dataDirFor: (id) => ensureDirectory(path.join(options.dataDir, "plugin-data", id)),
      logDirFor: (id) => ensureDirectory(path.join(options.dataDir, "logs", "plugins", id)),
      onOutput: (id, stream, text) => { const lines=this.output.get(id)??[]; lines.push(`[${stream}] ${text}`); this.output.set(id,lines.slice(-200)); options.onOutput?.(id,stream,text); },
    });
    this.moduleHost = new PluginModuleHost((id) => ensureDirectory(path.join(options.dataDir, "plugin-data", id)));
    this.state.reconcile();
  }

  setCatalog(catalog: PluginCatalog): void { this.catalog = catalog; }

  catalogSnapshot(): PluginCatalog | null { return this.catalog ? structuredClone(this.catalog) : null; }
  logs(pluginId: string): string[] { return [...(this.output.get(pluginId) ?? [])]; }
  isBusy(): boolean { return this.operations.size > 0; }

  availableUpdates(): Array<{ id: string; version: string }> {
    if (!this.catalog) return [];
    const state=this.state.snapshot();
    const updates:Array<{id:string;version:string}>=[];
    for(const [id,installed] of Object.entries(state.plugins)){
      if(!installed.activeVersion)continue;
      const currentVersion=installed.activeVersion;
      const release=this.catalog.releases.filter(item=>item.manifest.id===id&&item.manifest.platform===this.options.platform&&compareVersions(item.manifest.version,currentVersion)>0&&!this.catalog!.revoked.some(revoked=>revoked.id===id&&revoked.version===item.manifest.version))
        .sort((a,b)=>compareVersions(b.manifest.version,a.manifest.version))[0];
      if(release)updates.push({id,version:release.manifest.version});
    }
    return updates;
  }
  isEnabled(pluginId: string): boolean { const item=this.state.snapshot().plugins[pluginId]; return !!item?.enabled && !!item.activeVersion; }

  inventory(): PluginInventoryItem[] {
    const state = this.state.snapshot();
    const known = new Map<string, (typeof FIRST_PARTY_PLUGINS)[number]>(FIRST_PARTY_PLUGINS.map((item) => [item.id, item]));
    const ids = new Set([...known.keys(), ...Object.keys(state.plugins), ...(this.catalog?.releases.map((item) => item.manifest.id) ?? [])]);
    return [...ids].sort().map((id) => {
      const installed = state.plugins[id];
      const fallback = known.get(id);
      const releases = this.catalog?.releases.filter((item) => item.manifest.id === id && item.manifest.platform === this.options.platform && !this.catalog?.revoked.some((revoked)=>revoked.id===id&&revoked.version===item.manifest.version)) ?? [];
      const activeRelease = releases.find((item) => item.manifest.version === installed?.activeVersion);
      const latestRelease = [...releases].sort((a,b)=>compareVersions(b.manifest.version,a.manifest.version))[0];
      const display = activeRelease?.manifest ?? latestRelease?.manifest ?? this.readActiveManifest(id);
      const compatibility = display ? checkPluginCompatibility(display, {
        coreVersion: this.options.coreVersion,
        platform: this.options.platform,
      }) : null;
      const running = this.supervisor.get(id);
      const newer = installed?.activeVersion && latestRelease && compareVersions(latestRelease.manifest.version,installed.activeVersion)>0;
      const stateName = compatibility && !compatibility.compatible ? "incompatible"
        : newer ? "update-available"
        : running ? "ready"
        : installed?.enabled && installed.lastError ? "failed"
        : installed?.enabled ? "installed"
        : installed ? "disabled"
        : "available";
      return {
        id,
        name: display?.name ?? fallback?.name ?? id,
        version: newer ? latestRelease.manifest.version : installed?.activeVersion ?? display?.version ?? null,
        state: stateName,
        required: display?.required ?? fallback?.required ?? false,
        capabilities: display?.capabilities ?? [...(fallback?.capabilities ?? [])],
        error: installed?.lastError ?? (!installed && releases.length === 0 ? (this.catalog ? "No compatible release is available" : "Plugin catalog is not configured") : null),
      };
    });
  }

  async install(release: PluginCatalogRelease, artifactBaseUrl: string, extra: Partial<PluginInstallOptions> = {}): Promise<void> {
    if (this.shuttingDown) throw new Error("Plugin manager is shutting down");
    if (this.operations.has(release.manifest.id)) throw new Error("Another operation is already running for this plugin");
    this.operations.add(release.manifest.id);
    try {
    if (this.catalog?.revoked.some((item) => item.id === release.manifest.id && item.version === release.manifest.version)) throw new Error("Plugin version has been revoked");
    const compatibility = checkPluginCompatibility(release.manifest, {
      coreVersion: this.options.coreVersion,
      platform: this.options.platform,
    });
    if (!compatibility.compatible) throw new Error(`Plugin is incompatible: ${compatibility.reason}`);
    await this.installer.install(release, { artifactBaseUrl, publicKey: this.options.publicKey, ...extra });
    } finally { this.operations.delete(release.manifest.id); }
  }

  async installFromCatalog(pluginId: string, version: string, catalogUrl: string, extra: Partial<PluginInstallOptions> = {}): Promise<void> {
    const release = this.catalog?.releases.find((item) => item.manifest.id === pluginId && item.manifest.version === version && item.manifest.platform === this.options.platform);
    if (!release) throw new Error("Plugin release is not present in the loaded catalog");
    for (const dependency of release.manifest.dependencies) {
      const state = this.state.snapshot().plugins[dependency.id];
      if (state?.activeVersion && state.enabled && coreVersionSatisfies(state.activeVersion, dependency.version)) continue;
      const dependencyRelease = this.catalog?.releases
        .filter((item) => item.manifest.id === dependency.id && item.manifest.platform === this.options.platform && coreVersionSatisfies(item.manifest.version, dependency.version))
        .sort((a, b) => b.manifest.version.localeCompare(a.manifest.version))[0];
      if (!dependencyRelease) throw new Error(`Required dependency is unavailable: ${dependency.id} ${dependency.version}`);
      if (!state?.installedVersions.includes(dependencyRelease.manifest.version)) await this.installFromCatalog(dependency.id, dependencyRelease.manifest.version, catalogUrl, extra);
      await this.enable(dependency.id, dependencyRelease.manifest.version);
    }
    await this.install(release, catalogUrl, extra);
  }

  async updateFromCatalog(pluginId: string, version: string, catalogUrl: string, extra: Partial<PluginInstallOptions> = {}): Promise<void> {
    const previous = this.state.snapshot().plugins[pluginId];
    const previousVersion = previous?.activeVersion ?? null;
    if (previousVersion && compareVersions(version, previousVersion) <= 0) throw new Error("Plugin updates must use a newer version");
    if (!previous?.installedVersions.includes(version)) await this.installFromCatalog(pluginId, version, catalogUrl, extra);
    await this.activateInstalledUpdate(pluginId, version);
  }

  async activateInstalledUpdate(pluginId:string,version:string):Promise<void>{
    const previous=this.state.snapshot().plugins[pluginId];
    const previousVersion=previous?.activeVersion??null;
    if(previousVersion&&compareVersions(version,previousVersion)<=0)throw new Error("Plugin updates must use a newer version");
    const wasEnabled = previous?.enabled ?? false;
    try {
      if (wasEnabled) await this.disable(pluginId);
      await this.enable(pluginId, version);
      this.pruneVersions(pluginId, 2);
    } catch (error) {
      try {
        await this.disable(pluginId);
        if (wasEnabled && previousVersion) await this.enable(pluginId, previousVersion);
      } catch { /* preserve the original update error */ }
      throw error;
    }
  }

  async enable(pluginId: string, version: string): Promise<void> {
    const installed = this.state.snapshot().plugins[pluginId];
    if (!installed?.installedVersions.includes(version)) throw new Error("Plugin version is not installed");
    const manifest = this.readManifest(pluginId, version);
    if (this.catalog?.revoked.some((item) => item.id === pluginId && item.version === version)) throw new Error("Plugin version has been revoked");
    const compatibility = checkPluginCompatibility(manifest, { coreVersion: this.options.coreVersion, platform: this.options.platform });
    if (!compatibility.compatible) throw new Error(`Plugin is incompatible: ${compatibility.reason}`);
    for (const dependency of manifest.dependencies) {
      const installedDependency = this.state.snapshot().plugins[dependency.id];
      if (!installedDependency?.enabled || !installedDependency.activeVersion || !coreVersionSatisfies(installedDependency.activeVersion, dependency.version)) {
        throw new Error(`Enable dependency ${dependency.id} ${dependency.version} first`);
      }
    }
    const pluginDir = pluginVersionDir(this.options.paths, pluginId, version);
    try {
      if (manifest.entry.kind === "service") await this.supervisor.start(manifest, pluginDir);
      if (manifest.entry.kind === "module") await this.moduleHost.load(manifest, pluginDir);
      this.installer.activate(manifest);
    } catch (error) {
      this.state.update((draft) => {
        const plugin = draft.plugins[pluginId];
        if (plugin) plugin.lastError = error instanceof Error ? error.message : String(error);
      });
      throw error;
    }
  }

  async disable(pluginId: string): Promise<void> {
    await this.supervisor.stop(pluginId);
    try { await this.moduleHost.unload(pluginId); } catch { /* plugin may not be a loaded module */ }
    this.state.update((draft) => {
      const plugin = draft.plugins[pluginId];
      if (plugin) { plugin.enabled = false; plugin.lastError = null; }
    });
  }

  async uninstall(pluginId: string, version: string): Promise<void> {
    const active = this.state.snapshot().plugins[pluginId]?.activeVersion === version;
    if (active) await this.disable(pluginId);
    this.installer.uninstall(pluginId, version);
  }

  async startEnabled(): Promise<void> {
    for (const [id, plugin] of Object.entries(this.state.snapshot().plugins)) {
      if (!plugin.enabled || !plugin.activeVersion) continue;
      if (this.supervisor.get(id)) continue;
      try { await this.enable(id, plugin.activeVersion); }
      catch { /* enable records the error; other plugins still start */ }
    }
  }

  async installRequiredFromDirectory(directory: string, catalog: PluginCatalog): Promise<number> {
    let installed = 0;
    for (const release of catalog.releases) {
      if (!release.manifest.required || release.manifest.platform !== this.options.platform) continue;
      const state = this.state.snapshot().plugins[release.manifest.id];
      if (state?.installedVersions.includes(release.manifest.version)) continue;
      const artifactPath = path.resolve(directory, ...release.artifact.url.split("/"));
      if (!artifactPath.startsWith(path.resolve(directory) + path.sep)) throw new Error("Bundled artifact escapes its repository");
      await this.install(release, "https://bundled.invalid/", { artifactPath });
      await this.enable(release.manifest.id, release.manifest.version);
      installed++;
    }
    return installed;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.operations.size > 0) throw new Error("Cannot shut down while a plugin operation is active");
    await Promise.all([this.supervisor.stopAll(), this.moduleHost.shutdown()]);
  }

  private pruneVersions(pluginId:string,keep:number):void{const state=this.state.snapshot().plugins[pluginId];if(!state)return;const retained=new Set([state.activeVersion,...state.installedVersions.slice().sort((a,b)=>compareVersions(b,a)).slice(0,keep)].filter((item):item is string=>!!item));for(const version of state.installedVersions)if(!retained.has(version))this.installer.uninstall(pluginId,version);}

  private readActiveManifest(pluginId: string): PluginManifest | undefined {
    const version = this.state.snapshot().plugins[pluginId]?.activeVersion;
    if (!version) return undefined;
    try { return this.readManifest(pluginId, version); } catch { return undefined; }
  }

  private readManifest(pluginId: string, version: string): PluginManifest {
    return PluginManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(pluginVersionDir(this.options.paths, pluginId, version), "manifest.json"), "utf8")));
  }
}

function ensureDirectory(directory: string): string {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function compareVersions(a:string,b:string):number{const left=a.split(".").map(Number),right=b.split(".").map(Number);for(let i=0;i<Math.max(left.length,right.length);i++){const delta=(left[i]||0)-(right[i]||0);if(delta)return delta;}return 0;}
