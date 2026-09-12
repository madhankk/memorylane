import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaDto } from "@memorylane/shared";
import { api } from "../api/client";

interface ViewerProps {
  items: MediaDto[];
  startIndex: number;
  onClose: () => void;
}

const SLIDESHOW_INTERVAL_MS = 5000;

function displaySrc(media: MediaDto, useFallback: boolean): string {
  // RAW files can't be decoded by the browser - always show the generated
  // thumbnail (largest available preview) rather than the original bytes.
  if (media.mediaType === "raw" || useFallback) return api.media.thumbnailUrl(media.id);
  return api.media.fileUrl(media.id);
}

export default function Viewer({ items, startIndex, onClose }: ViewerProps) {
  const [index, setIndex] = useState(startIndex);
  const [fallback, setFallback] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    <div className="viewer-overlay" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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
