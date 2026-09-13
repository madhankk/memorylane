// A deliberately simple version check, not a real auto-updater: fetches a
// small JSON manifest from the public GitHub repo and compares it against
// the running app's own version. Never blocks startup and never throws -
// this is a "let them know" nicety, not something that should ever be able
// to break the app (e.g. offline, GitHub unreachable, malformed response).
const VERSION_MANIFEST_URL = "https://raw.githubusercontent.com/madhankk/memorylane/main/version.json";
const FETCH_TIMEOUT_MS = 5000;

export interface UpdateStatus {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  url?: string;
}

interface VersionManifest {
  version: string;
  url: string;
}

// Plain numeric x.y.z comparison - good enough for this project's versioning,
// no need to pull in a real semver package for it.
function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split(".").map((n) => Number(n) || 0);
  const currentParts = current.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (l !== c) return l > c;
  }
  return false;
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateStatus> {
  const fallback: UpdateStatus = { available: false, currentVersion };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(VERSION_MANIFEST_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return fallback;

    const manifest = (await res.json()) as Partial<VersionManifest>;
    if (typeof manifest.version !== "string") return fallback;

    return {
      available: isNewerVersion(manifest.version, currentVersion),
      currentVersion,
      latestVersion: manifest.version,
      url: typeof manifest.url === "string" ? manifest.url : undefined,
    };
  } catch {
    // Offline, GitHub unreachable, timed out, malformed JSON - all the same
    // "couldn't check, no big deal" outcome.
    return fallback;
  }
}
