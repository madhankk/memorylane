import { describe, it, expect } from "vitest";
import { groupBursts, type StackCandidate } from "../../src/stacks/stacker.js";

const H0 = "0000000000000000";
const H1 = "0000000000000001"; // 1 bit from H0
const HFAR = "ffffffffffffffff";
let n = 0;
const c = (o: Partial<StackCandidate>): StackCandidate => ({
  id: ++n,
  filename: `IMG_${String(n).padStart(4, "0")}.jpg`,
  capturedAt: "2024-05-12T10:31:44.000",
  body: "R5-1",
  phash: H0,
  burstId: null,
  ...o,
});
const t = (ms: number) => new Date(Date.UTC(2024, 4, 12, 10, 31, 44, 0) + ms).toISOString().slice(0, 23);

describe("groupBursts", () => {
  it("groups a tight sequence with matching hashes; leaves singles alone", () => {
    n = 0;
    const rows = [c({ capturedAt: t(0) }), c({ capturedAt: t(100), phash: H1 }), c({ capturedAt: t(200) }), c({ capturedAt: t(10_000) })];
    expect(groupBursts(rows)).toEqual([[1, 2, 3]]);
  });
  it("splits on time gap, body change, and visual distance", () => {
    n = 0;
    const rows = [
      c({ capturedAt: t(0) }), c({ capturedAt: t(500) }), // pair 1
      c({ capturedAt: t(3500) }), c({ capturedAt: t(3600) }), // gap > 2s -> pair 2
      c({ capturedAt: t(3700), body: "5D" }), // other body -> alone
      c({ capturedAt: t(3800), phash: HFAR }), // far hash -> alone
    ];
    expect(groupBursts(rows)).toEqual([[1, 2], [3, 4]]);
  });
  it("trusts a shared camera burst id even when hashes differ", () => {
    n = 0;
    const rows = [c({ capturedAt: t(0), burstId: "B1", phash: H0 }), c({ capturedAt: t(100), burstId: "B1", phash: HFAR })];
    expect(groupBursts(rows)).toEqual([[1, 2]]);
  });
  it("skips rows without a capture time or body, and sorts by time then filename", () => {
    n = 0;
    const rows = [
      c({ capturedAt: t(100), filename: "b.jpg" }), c({ capturedAt: t(0), filename: "a.jpg" }),
      c({ capturedAt: null }), c({ capturedAt: t(200), body: null }),
    ];
    expect(groupBursts(rows)).toEqual([[2, 1]]);
  });
  it("requires hashes on both sides unless a burst id matches", () => {
    n = 0;
    expect(groupBursts([c({ capturedAt: t(0), phash: null }), c({ capturedAt: t(50) })])).toEqual([]);
  });
  it("honours custom thresholds", () => {
    n = 0;
    const rows = [c({ capturedAt: t(0) }), c({ capturedAt: t(2500) })];
    expect(groupBursts(rows, { gapSeconds: 2, maxHamming: 14 })).toEqual([]);
    expect(groupBursts(rows, { gapSeconds: 3, maxHamming: 14 })).toEqual([[1, 2]]);
  });
});
