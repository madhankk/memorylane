import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import type { ScanRootDto, SettingsDto, ScanStatusDto, ScanRunDto, StorageStatsDto, IgnoredPathDto, AnalysisStatusDto } from "@memorylane/shared";
import { api, ApiError } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { useTheme, THEMES, type Theme } from "../hooks/useTheme";
import { formatBytes } from "../utils/format";
import TranscodeCandidatesPanel from "../components/TranscodeCandidatesPanel";
import AnalysisProgress from "../components/AnalysisProgress";

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

function ChangePasswordForm() {
  const [expanded, setExpanded] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await api.auth.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change password");
    } finally {
      setSubmitting(false);
    }
  };

  if (!expanded) {
    return (
      <button onClick={() => setExpanded(true)} className="text-sm font-medium text-accent hover:underline">
        Change password
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Current password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        required
        className={inputClass}
      />
      <input
        type="password"
        autoComplete="new-password"
        placeholder="New password (min. 8 characters)"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        minLength={8}
        required
        className={inputClass}
      />
      <input
        type="password"
        autoComplete="new-password"
        placeholder="Confirm new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        minLength={8}
        required
        className={inputClass}
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">Password changed. You'll stay signed in here; any other signed-in devices have been signed out.</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting} className={accentButtonClass}>
          {submitting ? "Changing..." : "Change Password"}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setError(null);
            setSuccess(false);
          }}
          className="text-sm text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// Live progress for one scan run, shown directly under the folder it's
// currently working on (see activeScanRootId in SettingsPage) rather than as
// one undifferentiated block elsewhere on the page.
function ScanProgress({ run }: { run: ScanRunDto }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2.5 text-xs text-muted">
      <p>
        {run.filesScanned.toLocaleString()} files scanned, {run.filesNew.toLocaleString()} new,{" "}
        {run.errorCount.toLocaleString()} errors so far.
      </p>
      {run.thumbnailsQueued > 0 && (
        <div className="flex flex-col gap-1">
          <p>
            {run.thumbnailsProcessed < run.thumbnailsQueued ? "Generating thumbnails: " : "Thumbnails done: "}
            {run.thumbnailsProcessed.toLocaleString()} of {run.thumbnailsQueued.toLocaleString()}
          </p>
          <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${Math.min(100, (run.thumbnailsProcessed / run.thumbnailsQueued) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [scanRoots, setScanRoots] = useState<ScanRootDto[]>([]);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [status, setStatus] = useState<ScanStatusDto | null>(null);
  const [newPath, setNewPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageStatsDto | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [ignoredPaths, setIgnoredPaths] = useState<IgnoredPathDto[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const [openTranscodeRootId, setOpenTranscodeRootId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisStatusDto | null>(null);
  const { theme, setTheme } = useTheme();

  // Live counts come from the AnalysisProgress component (it owns the polling);
  // this copy only drives the provider card and the Retry button.
  const [analysisKey, setAnalysisKey] = useState(0);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);
  const recomputeStacks = async () => {
    const res = await api.stacks.recompute();
    setRecomputeMsg(`Queued ${res.folders} folder(s) - stacks update in the background.`);
  };

  const retryAnalysis = async () => {
    await api.analysis.retryFailed();
    setAnalysisKey((k) => k + 1); // remount the progress view so it polls again
  };

  const loadAll = async () => {
    const [roots, s, st, ip, v] = await Promise.all([
      api.scanRoots.list(),
      api.settings.get(),
      api.scans.status(),
      api.ignoredPaths.list(),
      api.settings.version(),
    ]);
    setScanRoots(roots);
    setSettings(s);
    setStatus(st);
    setIgnoredPaths(ip);
    setVersion(v.version);
  };

  const removeIgnoredPath = async (id: number) => {
    await api.ignoredPaths.remove(id);
    setIgnoredPaths((prev) => prev.filter((p) => p.id !== id));
  };

  const loadStorage = async () => {
    setStorageLoading(true);
    try {
      setStorage(await api.settings.storage());
    } finally {
      setStorageLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    void loadStorage();
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

  const moveRoot = async (id: number, direction: "up" | "down") => {
    setScanRoots(await api.scanRoots.move(id, direction));
  };

  // Keeps the "N videos could be modernized" count in sync with the panel's
  // own list (e.g. right after an Archive) without waiting on a full reload.
  const updateTranscodeCount = (rootId: number, count: number) => {
    setScanRoots((prev) =>
      prev.map((r) => (r.id === rootId ? { ...r, stats: { ...r.stats, transcodeCandidateCount: count } } : r)),
    );
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

  // The root whose progress should be shown right now - a single-folder
  // "Scan Now" run's own fixed scope, or (for an all-folders run) whichever
  // root the scanner is actively walking at this moment. Either way, this is
  // the id the per-root list below matches against to show progress inline
  // under that specific folder instead of as one undifferentiated block.
  const activeScanRootId = status?.running
    ? (status.currentRun?.scanRootId ?? status.currentRun?.currentScanRootId ?? null)
    : null;

  const updateSchedule = async (patch: Partial<SettingsDto>) => {
    const updated = await api.settings.update(patch);
    setSettings(updated);
    // Toggling AI/People changes what the worker will process next - make the
    // progress view poll again so the bars start moving without a reload.
    if (patch.aiEnabled !== undefined || patch.personsEnabled !== undefined) setAnalysisKey((k) => k + 1);
  };

  if (!settings) return <p className="text-sm text-muted">Loading...</p>;

  return (
    <div className="flex flex-col gap-10">
      <h1 className="font-serif text-2xl font-semibold text-ink">Settings</h1>

      <section>
        <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Account</h2>
        {user && <p className="mb-3 text-sm text-muted">Signed in as <span className="font-medium text-ink">{user.username}</span></p>}
        <ChangePasswordForm />
      </section>

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
        <p className="mb-2 text-xs text-muted">Order here also sets the order folders appear in on the Home page.</p>
        <ul className="flex flex-col gap-2">
          {scanRoots.map((root, i) => (
            <li
              key={root.id}
              className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex shrink-0 flex-col">
                  <button
                    onClick={() => moveRoot(root.id, "up")}
                    disabled={i === 0}
                    aria-label="Move up"
                    title="Move up"
                    className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronUp size={14} strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => moveRoot(root.id, "down")}
                    disabled={i === scanRoots.length - 1}
                    aria-label="Move down"
                    title="Move down"
                    className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronDown size={14} strokeWidth={2} />
                  </button>
                </div>
                <div className="mr-auto flex min-w-0 flex-col gap-0.5">
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
              </div>
              {/* Live progress for whichever run currently has this folder active -
                  a single-folder "Scan Now" run's own scope, or (during an
                  all-folders run) whichever root the scanner has reached so far -
                  shown right under the folder it's actually working on. */}
              {status?.running && status.currentRun && activeScanRootId === root.id && (
                <ScanProgress run={status.currentRun} />
              )}
              {root.stats.transcodeCandidateCount > 0 && (
                <div className="border-t border-border pt-2.5">
                  <button
                    onClick={() => setOpenTranscodeRootId(root.id)}
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    {root.stats.transcodeCandidateCount.toLocaleString()} video
                    {root.stats.transcodeCandidateCount === 1 ? "" : "s"} could be modernized →
                  </button>
                </div>
              )}
            </li>
          ))}
          {scanRoots.length === 0 && <li className="text-sm text-muted">No folders added yet.</li>}
        </ul>
      </section>

      {openTranscodeRootId != null && (
        <TranscodeCandidatesPanel
          scanRootId={openTranscodeRootId}
          onClose={() => setOpenTranscodeRootId(null)}
          onCountChange={(count) => updateTranscodeCount(openTranscodeRootId, count)}
        />
      )}

      <section>
        <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Ignored Folders</h2>
        <p className="mb-3 text-sm text-muted">
          Folders MemoryLane skips during every scan - click "Ignore folder" while browsing a folder to add it here.
          Removing one from this list doesn't restore anything; it'll be picked up fresh on the next scan.
        </p>
        <ul className="flex flex-col gap-2">
          {ignoredPaths.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-3.5 py-2.5"
            >
              <span className="min-w-0 truncate text-ink" title={p.path}>
                {p.path}
              </span>
              <button
                onClick={() => removeIgnoredPath(p.id)}
                aria-label="Remove from ignore list"
                title="Remove from ignore list"
                className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-hover hover:text-ink"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </li>
          ))}
          {ignoredPaths.length === 0 && <li className="text-sm text-muted">No ignored folders.</li>}
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
          <div className="mt-4 flex flex-col gap-3 text-sm text-muted">
            {/* Per-folder progress is shown inline under each folder above
                (see activeScanRootId/ScanProgress) - this only covers the
                brief window right at the start of a run before the scanner
                has attributed itself to a specific folder yet. */}
            {status.running && activeScanRootId === null && <p>Starting scan...</p>}
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

      <section>
        <h2 className="mb-1 font-serif text-lg font-semibold text-ink">AI</h2>
        <p className="mb-3 text-sm text-muted">
          An optional local sidecar (<code>memorylane-ai</code>) turns photos into vectors for Find similar, describe-it search and
          smarter stacks. Nothing leaves your machine.
        </p>
        <label className="mb-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={settings.aiEnabled}
            onChange={(e) => updateSchedule({ aiEnabled: e.target.checked })}
            className="accent-accent"
          />
          Analyse photos with the AI sidecar when it's running
        </label>
        {analysis && (
          <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
            {analysis.provider === null && <p className="text-muted">No AI provider configured (MEMORYLANE_AI_PROVIDER=none).</p>}
            {analysis.provider && analysis.provider.reachable && (
              <p className="text-ink">
                <span className="mr-2 inline-block size-2 rounded-full bg-green-500 align-middle" aria-hidden />
                Connected to <code>{analysis.provider.url}</code> · {analysis.provider.model} · {analysis.provider.device}
              </p>
            )}
            {analysis.provider && !analysis.provider.reachable && (
              <div className="text-ink">
                <p>
                  <span className="mr-2 inline-block size-2 rounded-full bg-amber-500 align-middle" aria-hidden />
                  Not connected to <code>{analysis.provider.url}</code>
                  {analysis.provider.lastError ? ` - ${analysis.provider.lastError}` : ""}
                </p>
                <p className="mt-1 text-muted">
                  Start it with <code>cd memorylane-ai && .venv/bin/memorylane-ai</code> (see memorylane-ai/README.md). Photos queue up
                  meanwhile and are analysed once it's reachable.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-serif text-lg font-semibold text-ink">Analysis</h2>
        <p className="mb-3 text-sm text-muted">
          Background processing that runs after scans - full EXIF capture for Reports. Pauses automatically while a scan
          is running.
        </p>
        <AnalysisProgress key={analysisKey} onStatus={setAnalysis} />
        {analysis && analysis.analyzers.some((a) => a.counts.failed + a.counts.unsupported > 0) && (
          <div className="mt-3">
            <button onClick={() => void retryAnalysis()} className={buttonClass}>
              Retry failed
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-serif text-lg font-semibold text-ink">People</h2>
        <p className="mb-3 text-sm text-muted">
          Finds faces and groups them into people you can name, then lets you browse "photos of X". Off by default because faces are
          personal data; everything is computed and stored on this machine only, and can be removed in one click.
        </p>
        <label className="mb-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={settings.personsEnabled}
            onChange={(e) => updateSchedule({ personsEnabled: e.target.checked })}
            className="accent-accent"
          />
          Find and group faces (needs the AI sidecar)
        </label>
        <p className="mb-2 text-xs text-muted">
          Siblings and young children look alike to the model - if one person collects several kids, raise both strictness values
          (0.55-0.6 is a good start) and press Regroup. Stricter means more small "Person N" entries to merge, which is cheaper than
          un-mixing a wrong one face by face.
        </p>
        <div className="flex flex-wrap items-end gap-4 text-sm text-ink">
          <label className="flex flex-col gap-1">
            <span className="text-muted">Match strictness (min similarity, 0.3-0.9)</span>
            <input
              type="number"
              min={0.3}
              max={0.9}
              step={0.05}
              defaultValue={settings.faceAssignThreshold}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v >= 0.3 && v <= 0.9 && v !== settings.faceAssignThreshold) void updateSchedule({ faceAssignThreshold: v });
              }}
              className={`w-24 ${inputClass}`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Faces needed to create a person (2-20)</span>
            <input
              type="number"
              min={2}
              max={20}
              step={1}
              defaultValue={settings.faceMinClusterSize}
              onBlur={(e) => {
                const v = Math.round(Number(e.target.value));
                if (v >= 2 && v <= 20 && v !== settings.faceMinClusterSize) void updateSchedule({ faceMinClusterSize: v });
              }}
              className={`w-24 ${inputClass}`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Grouping strictness (0.3-0.9)</span>
            <input
              type="number"
              min={0.3}
              max={0.9}
              step={0.05}
              defaultValue={settings.faceLinkThreshold}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v >= 0.3 && v <= 0.9 && v !== settings.faceLinkThreshold) void updateSchedule({ faceLinkThreshold: v });
              }}
              className={`w-24 ${inputClass}`}
            />
          </label>
          <button
            className={buttonClass}
            title="Regroup all automatically grouped faces with the current settings. Names and your ✓/✗ answers are kept."
            onClick={async () => {
              if (window.confirm("Regroup faces with the current strictness? Names and your confirmed/rejected faces are kept; automatic groupings are redone.")) {
                const r = await api.persons.regroup();
                window.alert(`Regrouped: ${r.persons} new people, ${r.assigned} faces assigned.`);
              }
            }}
          >
            Regroup with these settings
          </button>
          <button
            className={`${buttonClass} text-red-600`}
            onClick={async () => {
              if (window.confirm("Delete all face data? People, faces and their vectors are removed. Photos are untouched. Faces are re-detected only if People is on.")) {
                await api.persons.deleteAllData();
                setAnalysisKey((k) => k + 1);
              }
            }}
          >
            Delete all face data
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-serif text-lg font-semibold text-ink">Stacks</h2>
        <p className="mb-3 text-sm text-muted">
          Bursts of near-identical shots (same camera, seconds apart, visually alike) are grouped into one grid item.
          Stacks you edit are never regrouped automatically.
        </p>
        <div className="flex flex-wrap items-end gap-4 text-sm text-ink">
          <label className="flex flex-col gap-1">
            <span className="text-muted">Burst gap (seconds)</span>
            <input
              type="number"
              min={0.1}
              max={60}
              step={0.5}
              defaultValue={settings.stackGapSeconds}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v > 0 && v !== settings.stackGapSeconds) void updateSchedule({ stackGapSeconds: v });
              }}
              className={`w-24 ${inputClass}`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Visual similarity (max hash distance, 0-64)</span>
            <input
              type="number"
              min={0}
              max={64}
              step={1}
              defaultValue={settings.stackMaxHamming}
              onBlur={(e) => {
                const v = Math.round(Number(e.target.value));
                if (v >= 0 && v <= 64 && v !== settings.stackMaxHamming) void updateSchedule({ stackMaxHamming: v });
              }}
              className={`w-24 ${inputClass}`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">AI similarity (min cosine, 0.5-1)</span>
            <input
              type="number"
              min={0.5}
              max={1}
              step={0.01}
              defaultValue={settings.stackMinCosine}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v >= 0.5 && v <= 1 && v !== settings.stackMinCosine) void updateSchedule({ stackMinCosine: v });
              }}
              className={`w-24 ${inputClass}`}
            />
          </label>
          <button onClick={() => void recomputeStacks()} className={buttonClass}>
            Recompute all stacks
          </button>
        </div>
        {recomputeMsg && <p className="mt-2 text-sm text-muted">{recomputeMsg}</p>}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-serif text-lg font-semibold text-ink">Storage</h2>
          <button onClick={loadStorage} disabled={storageLoading} className={buttonClass}>
            {storageLoading ? "Calculating..." : "Refresh"}
          </button>
        </div>
        <p className="mb-3 text-sm text-muted">
          MemoryLane's own cache and index - entirely separate from your photo folders, and safe to delete and
          rebuild via a rescan at any time.
        </p>
        {storage ? (
          <ul className="flex flex-col gap-2">
            <li className="flex items-center justify-between rounded-lg border border-border bg-surface px-3.5 py-2.5">
              <span className="text-ink">Thumbnail cache</span>
              <span className="text-muted">{formatBytes(storage.thumbnailCacheBytes)}</span>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-border bg-surface px-3.5 py-2.5">
              <span className="text-ink">Database</span>
              <span className="text-muted">{formatBytes(storage.databaseBytes)}</span>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-border bg-surface px-3.5 py-2.5">
              <span className="text-ink">Logs</span>
              <span className="text-muted">{formatBytes(storage.logsBytes)}</span>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-accent bg-surface px-3.5 py-2.5 font-medium">
              <span className="text-ink">Total</span>
              <span className="text-ink">{formatBytes(storage.totalBytes)}</span>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-muted">Calculating...</p>
        )}
      </section>

      {version && <p className="text-center text-xs text-muted">MemoryLane v{version}</p>}
    </div>
  );
}
