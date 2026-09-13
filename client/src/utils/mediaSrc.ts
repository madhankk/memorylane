import type { MediaDto } from "@memorylane/shared";
import { api } from "../api/client";

// RAW files can't be decoded by the browser - always show the generated
// thumbnail (largest available preview) rather than the original bytes.
// Shared by every full-size photo display (fullscreen Viewer, inline
// slideshows) so they all get sharp, non-thumbnail images consistently.
export function displaySrc(media: MediaDto, useFallback: boolean): string {
  if (media.mediaType === "raw" || useFallback) return api.media.thumbnailUrl(media.id);
  return api.media.fileUrl(media.id);
}
