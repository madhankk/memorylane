import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Star } from "lucide-react";
import type { MediaDto } from "@memorylane/shared";
import { api } from "../api/client";
import { formatMemoryBlurb } from "../utils/blurb";
import { displaySrc } from "../utils/mediaSrc";
import { formatBytes, formatDuration } from "../utils/format";
import { useEngagementTracking } from "../hooks/useEngagementTracking";

interface ViewerProps {
  items: MediaDto[];
  startIndex: number;
  onClose: () => void;
  // Starts the slideshow playing immediately instead of requiring a manual Play click.
  autoPlay?: boolean;
  // The real total item count in this set, when it's larger than `items`
  // (a paginated folder/favorites view) - without this, reaching the end of
  // whatever page happens to be loaded silently wraps back to photo 1
  // instead of fetching more, since `items.length` alone can't tell the
  // difference between "that's really all of them" and "just not loaded yet".
  total?: number;
  onRequestMore?: () => void | Promise<void>;
}

const SLIDESHOW_INTERVAL_MS = 5000;

export default function Viewer({ items, startIndex, onClose, autoPlay = false, total, onRequestMore }: ViewerProps) {
  const [index, setIndex] = useState(startIndex);
  const [fallback, setFallback] = useState(false);
  const [playing, setPlaying] = useState(autoPlay);
  // A Live Photo opens on its still image - this only becomes true once the
  // user explicitly taps the LIVE badge to play the paired ~3s video.
  const [livePlaying, setLivePlaying] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<number, boolean>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  // Set when goNext() is waiting on more items to arrive rather than
  // wrapping - the effect below advances the index once they land.
  const awaitingMoreRef = useRef(false);

  const current = items[index];
  useEngagementTracking(current?.id);

  // Always land on the still image first when navigating to a new item.
  useEffect(() => {
    setLivePlaying(false);
  }, [current?.id]);

  const totalCount = total ?? items.length;

  const goNext = useCallback(() => {
    setFallback(false);
    setIndex((i) => {
      if (i < items.length - 1) return i + 1;
      // At the end of what's loaded - if the real set is bigger, fetch more
      // and stay put until it arrives, rather than wrapping to photo 1.
      if (items.length < totalCount && onRequestMore) {
        awaitingMoreRef.current = true;
        void onRequestMore();
        return i;
      }
      return 0;
    });
  }, [items.length, totalCount, onRequestMore]);

  const goPrev = useCallback(() => {
    setFallback(false);
    setIndex((i) => (i - 1 + items.length) % items.length);
  }, [items.length]);

  // Fires once the parent's items array actually grows past where we were
  // waiting - advancing here (rather than inside goNext itself) means it
  // still works no matter how long the fetch takes.
  useEffect(() => {
    if (awaitingMoreRef.current && items.length > index) {
      awaitingMoreRef.current = false;
      setIndex((i) => i + 1);
    }
  }, [items.length, index]);

  const goToFolder = useCallback(() => {
    if (!current) return;
    onClose();
    navigate(`/folder/${current.parentFolderId}`);
  }, [current, navigate, onClose]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === " ") {
        // Don't hijack Space when a button/input (or a focused video, whose
        // own native space-to-pause should win) already owns it - a global
        // slideshow toggle stealing the keystroke out from under it would
        // fire both at once.
        const target = e.target as HTMLElement | null;
        if (target && ["BUTTON", "INPUT", "TEXTAREA", "A", "VIDEO"].includes(target.tagName)) return;
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, onClose]);

  // A video playing (standalone, or a Live Photo's tapped-into video) drives
  // its own advance via onEnded below instead of the fixed interval - cutting
  // it off after 5s regardless of length wouldn't feel like part of the same
  // slideshow, it'd feel like the video was interrupted.
  const isVideoActive = current?.mediaType === "video" || livePlaying;
  useEffect(() => {
    if (playing && !isVideoActive) {
      timerRef.current = setInterval(goNext, SLIDESHOW_INTERVAL_MS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, isVideoActive, goNext]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      overlayRef.current?.requestFullscreen().catch(() => {
        // Fullscreen can be denied (no user gesture, unsupported, iframe restrictions) - the
        // overlay already covers the whole viewport, so the slideshow still works fine without it.
      });
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    // Auto-play implies "start the full slideshow experience" - try to go fullscreen too.
    if (autoPlay && !document.fullscreenElement) {
      overlayRef.current?.requestFullscreen().catch(() => {});
    }

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      // Don't leave the browser stuck in fullscreen once the viewer closes.
      if (document.fullscreenElement) void document.exitFullscreen();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Basic touch swipe support.
  const touchStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (delta > 50) goPrev();
    else if (delta < -50) goNext();
    touchStartX.current = null;
  };

  if (!current) return null;

  const isFavorite = favoriteOverrides[current.id] ?? current.favorite;
  const toggleFavorite = async () => {
    const next = !isFavorite;
    setFavoriteOverrides((prev) => ({ ...prev, [current.id]: next }));
    try {
      await api.media.setFavorite(current.id, next);
    } catch {
      setFavoriteOverrides((prev) => ({ ...prev, [current.id]: !next }));
    }
  };

  const blurb = formatMemoryBlurb(current);

  const controlButtonClass =
    "h-12 w-12 rounded-full border-none bg-overlay-control text-2xl text-white transition-colors hover:bg-overlay-control-hover";

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay/97"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <button className={`absolute top-5 right-5 ${controlButtonClass}`} onClick={onClose} aria-label="Close">
        ✕
      </button>

      <button
        className={`absolute top-5 right-24 grid place-items-center ${controlButtonClass}`}
        onClick={toggleFavorite}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={isFavorite}
      >
        <Star
          size={22}
          strokeWidth={1.8}
          className={isFavorite ? "fill-amber-400 text-amber-400" : "text-white"}
        />
      </button>

      <button
        className={`absolute top-1/2 left-5 -translate-y-1/2 ${controlButtonClass}`}
        onClick={goPrev}
        aria-label="Previous"
      >
        ‹
      </button>

      <div className="relative flex max-h-[82vh] max-w-[92vw] items-center justify-center">
        {current.mediaType === "video" ? (
          // Original file served as-is (see file-streaming.ts's Range support
          // for seeking) - no transcoding, so playback depends entirely on
          // what the browser's own <video> element can decode.
          <video
            key={current.id}
            src={api.media.fileUrl(current.id)}
            controls
            autoPlay
            // When the slideshow is running, a video's own length stands in
            // for the fixed photo interval - it advances when playback
            // actually finishes rather than being cut off mid-clip.
            onEnded={() => {
              if (playing) goNext();
            }}
            className="max-h-[82vh] max-w-[92vw] object-contain"
          />
        ) : current.livePhotoVideoId != null && livePlaying ? (
          <video
            key={`${current.id}-live`}
            src={api.media.fileUrl(current.livePhotoVideoId)}
            autoPlay
            controls
            onEnded={() => {
              setLivePlaying(false);
              if (playing) goNext();
            }}
            className="max-h-[82vh] max-w-[92vw] object-contain"
          />
        ) : (
          <img
            key={current.id}
            src={displaySrc(current, fallback)}
            alt={current.filename}
            onError={() => {
              if (!fallback) setFallback(true);
            }}
            className="max-h-[82vh] max-w-[92vw] object-contain"
          />
        )}
        {current.livePhotoVideoId != null && !livePlaying && (
          <button
            onClick={() => setLivePlaying(true)}
            className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-overlay-control px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-overlay-control-hover"
            aria-label="Play Live Photo"
          >
            ◉ LIVE
          </button>
        )}
        {current.rawPairId != null && (
          // The browser can't render a RAW file inline - this just opens the
          // original in a new tab, where the browser's own download handling
          // takes over (no in-app RAW viewer/editor).
          <a
            href={api.media.fileUrl(current.rawPairId)}
            target="_blank"
            rel="noopener noreferrer"
            className={`absolute left-3 flex items-center gap-1 rounded-full bg-overlay-control px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-overlay-control-hover ${
              current.livePhotoVideoId != null ? "top-12" : "top-3"
            }`}
            aria-label="Open original RAW file"
          >
            RAW
          </a>
        )}
      </div>

      <button
        className={`absolute top-1/2 right-5 -translate-y-1/2 ${controlButtonClass}`}
        onClick={goNext}
        aria-label="Next"
      >
        ›
      </button>

      <div className="absolute bottom-5 left-1/2 flex max-w-[92vw] -translate-x-1/2 flex-col items-center gap-1.5">
        <div className="flex flex-wrap items-center justify-center gap-4 rounded-full bg-overlay-control px-4 py-2 text-sm text-white">
          <button onClick={() => setPlaying((p) => !p)} className="text-white">
            {playing ? "Pause" : "Play"}
          </button>
          <span className="max-w-[240px] truncate">{current.filename}</span>
          <span>
            {index + 1} / {totalCount}
          </span>
          <button onClick={() => setShowInfo((s) => !s)} className="text-white">
            Info
          </button>
          <button onClick={toggleFullscreen} className="text-white">
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
        {/* Subtle caption below the photo, overlaid on the image rather than
            floating off to a corner. */}
        {blurb && <p className="text-xs font-medium text-white/60">{blurb}</p>}
      </div>

      {showInfo && (
        <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-col gap-1 rounded-lg bg-black/70 px-4.5 py-3 text-sm text-white">
          {current.capturedDate && <div>Taken: {new Date(current.capturedDate).toLocaleString()}</div>}
          {current.cameraMake && (
            <div>
              Camera: {current.cameraMake} {current.cameraModel}
            </div>
          )}
          {current.lensModel && <div>Lens: {current.lensModel}</div>}
          {current.width && current.height && (
            <div>
              Dimensions: {current.width} × {current.height}
            </div>
          )}
          <div>Type: {current.mediaType.toUpperCase()}</div>
          <div>Size: {formatBytes(current.fileSize)}</div>
          {current.durationSeconds != null && <div>Duration: {formatDuration(current.durationSeconds)}</div>}
          <div className="max-w-[360px] break-all text-white/70">Path: {current.absolutePath}</div>
          <button
            onClick={goToFolder}
            className="mt-1 self-start text-left text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            Go to folder
          </button>
        </div>
      )}
    </div>
  );
}
