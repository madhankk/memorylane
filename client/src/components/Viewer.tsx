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

  return (
    <div ref={overlayRef} className="viewer-overlay" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <button className="viewer-close" onClick={onClose} aria-label="Close">
        ✕
      </button>

      <button className="viewer-nav viewer-nav-prev" onClick={goPrev} aria-label="Previous">
        ‹
      </button>

      <div className="viewer-stage">
        <img
          key={current.id}
          src={displaySrc(current, fallback)}
          alt={current.filename}
          onError={() => {
            if (!fallback) setFallback(true);
          }}
        />
      </div>

      <button className="viewer-nav viewer-nav-next" onClick={goNext} aria-label="Next">
        ›
      </button>

      <div className="viewer-toolbar">
        <button onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
        <span className="viewer-filename">{current.filename}</span>
        <span className="viewer-position">
          {index + 1} / {items.length}
        </span>
        <button onClick={() => setShowInfo((s) => !s)}>Info</button>
        <button onClick={toggleFullscreen}>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</button>
      </div>

      {showInfo && (
        <div className="viewer-info">
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
