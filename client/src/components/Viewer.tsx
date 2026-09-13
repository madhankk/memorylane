import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaDto } from "@memorylane/shared";
import { api } from "../api/client";

interface ViewerProps {
  items: MediaDto[];
  startIndex: number;
  onClose: () => void;
  // Starts the slideshow playing immediately instead of requiring a manual Play click.
  autoPlay?: boolean;
}

const SLIDESHOW_INTERVAL_MS = 5000;

function displaySrc(media: MediaDto, useFallback: boolean): string {
  // RAW files can't be decoded by the browser - always show the generated
  // thumbnail (largest available preview) rather than the original bytes.
  if (media.mediaType === "raw" || useFallback) return api.media.thumbnailUrl(media.id);
  return api.media.fileUrl(media.id);
}

export default function Viewer({ items, startIndex, onClose, autoPlay = false }: ViewerProps) {
  const [index, setIndex] = useState(startIndex);
  const [fallback, setFallback] = useState(false);
  const [playing, setPlaying] = useState(autoPlay);
  const [showInfo, setShowInfo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const current = items[index];

  const goNext = useCallback(() => {
    setFallback(false);
    setIndex((i) => (i + 1) % items.length);
  }, [items.length]);

  const goPrev = useCallback(() => {
    setFallback(false);
    setIndex((i) => (i - 1 + items.length) % items.length);
  }, [items.length]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, onClose]);

  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(goNext, SLIDESHOW_INTERVAL_MS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, goNext]);

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
        className={`absolute top-1/2 left-5 -translate-y-1/2 ${controlButtonClass}`}
        onClick={goPrev}
        aria-label="Previous"
      >
        ‹
      </button>

      <div className="flex max-h-[82vh] max-w-[92vw] items-center justify-center">
        <img
          key={current.id}
          src={displaySrc(current, fallback)}
          alt={current.filename}
          onError={() => {
            if (!fallback) setFallback(true);
          }}
          className="max-h-[82vh] max-w-[92vw] object-contain"
        />
      </div>

      <button
        className={`absolute top-1/2 right-5 -translate-y-1/2 ${controlButtonClass}`}
        onClick={goNext}
        aria-label="Next"
      >
        ›
      </button>

      <div className="absolute bottom-5 left-1/2 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center justify-center gap-4 rounded-full bg-overlay-control px-4 py-2 text-sm text-white">
        <button onClick={() => setPlaying((p) => !p)} className="text-white">
          {playing ? "Pause" : "Play"}
        </button>
        <span className="max-w-[240px] truncate">{current.filename}</span>
        <span>
          {index + 1} / {items.length}
        </span>
        <button onClick={() => setShowInfo((s) => !s)} className="text-white">
          Info
        </button>
        <button onClick={toggleFullscreen} className="text-white">
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </button>
      </div>

      {showInfo && (
        <div className="absolute bottom-20 left-1/2 flex -translate-x-1/2 flex-col gap-1 rounded-lg bg-black/70 px-4.5 py-3 text-sm text-white">
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
        </div>
      )}
    </div>
  );
}
