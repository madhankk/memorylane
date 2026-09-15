import { hammingHex } from "./phash.js";

// Bump when the grouping rule changes so existing auto stacks are recomputed.
export const STACK_RULE_VERSION = "burst-v1";

export interface StackCandidate {
  id: number;
  filename: string;
  capturedAt: string | null; // media_exif.captured_at_precise (wall clock, ms)
  body: string | null; // camera serial, else model
  phash: string | null;
  burstId: string | null; // maker-note burst UUID when present
}

export interface StackerOptions {
  gapSeconds: number;
  maxHamming: number;
}

export const DEFAULT_STACKER_OPTIONS: StackerOptions = { gapSeconds: 2, maxHamming: 14 };

function parseMs(s: string): number {
  // Wall-clock strings carry no offset; treating them as UTC keeps
  // differences correct within one camera's stream, which is all we need.
  return Date.parse(`${s}Z`);
}

// Single time-sorted pass per folder (design doc §8.3): O(n), no pairwise
// blow-up. Photo j joins the open group when it shares a body with the
// previous member, follows it within gapSeconds, and is visually close
// (hash distance) OR carries the same camera burst id.
export function groupBursts(rows: StackCandidate[], opts: StackerOptions = DEFAULT_STACKER_OPTIONS): number[][] {
  const eligible = rows
    .filter((r) => r.capturedAt && r.body)
    .map((r) => ({ ...r, ms: parseMs(r.capturedAt as string) }))
    .filter((r) => Number.isFinite(r.ms))
    .sort((a, b) => a.ms - b.ms || a.filename.localeCompare(b.filename));

  const groups: number[][] = [];
  let current: typeof eligible = [];
  const flush = () => {
    if (current.length >= 2) groups.push(current.map((r) => r.id));
    current = [];
  };

  for (const r of eligible) {
    const prev = current[current.length - 1];
    if (prev) {
      const sameBody = prev.body === r.body;
      const closeInTime = r.ms - prev.ms <= opts.gapSeconds * 1000;
      const sameBurst = !!r.burstId && r.burstId === prev.burstId;
      const similar = !!r.phash && !!prev.phash && hammingHex(r.phash, prev.phash) <= opts.maxHamming;
      if (sameBody && closeInTime && (sameBurst || similar)) {
        current.push(r);
        continue;
      }
      flush();
    }
    current.push(r);
  }
  flush();
  return groups;
}
