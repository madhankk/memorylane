import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscodeCandidateDto, VideoTranscodeQuality } from "@memorylane/shared";
import { api, ApiError } from "../api/client";
import { formatBytes, formatDuration } from "../utils/format";

interface TranscodeCandidatesPanelProps {
  scanRootId: number;
  // Called after every refresh so the parent can keep its own "N videos
  // could be modernized" count in sync without a separate poll.
  onCountChange?: (count: number) => void;
}

const POLL_INTERVAL_MS = 2000;

const buttonClass =
  "rounded-md border border-border px-3 py-1.5 text-xs text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40";
const accentButtonClass =
  "rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-page hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export default function TranscodeCandidatesPanel({ scanRootId, onCountChange }: TranscodeCandidatesPanelProps) {
  const [candidates, setCandidates] = useState<TranscodeCandidateDto[] | null>(null);
  const [quality, setQuality] = useState<VideoTranscodeQuality>("standard");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const items = await api.transcode.candidates(scanRootId);
    setCandidates(items);
    onCountChange?.(items.length);
    return items;
  }, [scanRootId, onCountChange]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanRootId]);

  // Poll while anything's actively in flight - stops itself once everything
  // has settled into a terminal state (done/failed) for this render.
  useEffect(() => {
    const active = candidates?.some((c) => c.job?.status === "pending" || c.job?.status === "transcoding");
    if (active && !pollRef.current) {
      pollRef.current = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    } else if (!active && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [candidates, refresh]);

  const runAction = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  };

  if (!candidates) return <p className="text-xs text-muted">Loading...</p>;

  const verifiedIds = candidates.filter((c) => c.job?.status === "done" && c.job.verified).map((c) => c.media.id);
  const needsTranscodeIds = candidates
    .filter((c) => !c.job || c.job.status === "failed")
    .map((c) => c.media.id);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-page p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-muted">
            Quality
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as VideoTranscodeQuality)}
              className="rounded border border-border bg-surface px-1.5 py-1 text-ink outline-none focus:border-accent"
            >
              <option value="standard">Standard (smaller files)</option>
              <option value="high">Higher quality (larger files)</option>
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void runAction(() => api.transcode.start(scanRootId, needsTranscodeIds, quality))}
            disabled={needsTranscodeIds.length === 0}
            className={buttonClass}
          >
            Transcode All ({needsTranscodeIds.length})
          </button>
          <button
            onClick={() => void runAction(() => api.transcode.archive(scanRootId, verifiedIds))}
            disabled={verifiedIds.length === 0}
            className={accentButtonClass}
          >
            Archive All Verified ({verifiedIds.length})
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {candidates.length === 0 ? (
        <p className="text-xs text-muted">Nothing left to modernize in this folder.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((c) => (
            <CandidateRow
              key={c.media.id}
              candidate={c}
              scanRootId={scanRootId}
              quality={quality}
              onAction={runAction}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateRow({
  candidate,
  scanRootId,
  quality,
  onAction,
}: {
  candidate: TranscodeCandidateDto;
  scanRootId: number;
  quality: VideoTranscodeQuality;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { media, job } = candidate;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{media.filename}</div>
          <div className="text-muted">
            {media.durationSeconds != null ? formatDuration(media.durationSeconds) : "unknown length"} ·{" "}
            {formatBytes(media.fileSize)} · {media.codec ?? "unknown codec"}
            {media.audioCodec ? ` + ${media.audioCodec}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!job && (
            <button
              onClick={() => void onAction(() => api.transcode.start(scanRootId, [media.id], quality))}
              className={buttonClass}
            >
              Transcode
            </button>
          )}
          {job?.status === "pending" && <span className="text-muted">Queued...</span>}
          {job?.status === "transcoding" && <span className="text-muted">Transcoding...</span>}
          {job?.status === "failed" && (
            <button
              onClick={() => void onAction(() => api.transcode.start(scanRootId, [media.id], quality))}
              className={buttonClass}
            >
              Retry
            </button>
          )}
          {job?.status === "done" && job.verified && (
            <button
              onClick={() => void onAction(() => api.transcode.archive(scanRootId, [media.id]))}
              className={accentButtonClass}
            >
              Archive
            </button>
          )}
        </div>
      </div>

      {job?.status === "failed" && job.error && <p className="text-red-500">{job.error}</p>}

      {job?.status === "done" && job.verified && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2">
          <p className="text-muted">
            New file: {job.outputDurationSeconds != null ? formatDuration(job.outputDurationSeconds) : "?"} ·{" "}
            {job.outputSizeBytes != null ? formatBytes(job.outputSizeBytes) : "?"} · ✓ duration match · ✓ playable
          </p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={api.transcode.previewUrl(media.id)} controls className="max-h-48 max-w-full rounded" />
        </div>
      )}
    </li>
  );
}
