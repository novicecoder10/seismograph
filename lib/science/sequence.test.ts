import { describe, expect, it } from "vitest";
import type { CatalogEvent } from "./decluster";
import { mulberry32, syntheticGutenbergRichter } from "./random";
import { isRefusal } from "./refusal";
import {
  analyseSequence,
  classifySequence,
  sequenceQueryWindow,
  wellsCoppersmithRuptureKm,
} from "./sequence";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

const ev = (id: string, days: number, magnitude: number, dLat = 0, dLon = 0): CatalogEvent => ({
  id,
  time: T0 + days * DAY,
  lat: 35 + dLat,
  lon: -117 + dLon,
  depthKm: 8,
  magnitude,
});

/** A mainshock with an Omori-distributed, Gutenberg-Richter-sized aftershock
 *  sequence scattered within ~15 km. */
function syntheticSequence(seed: number, mainMag = 6.5, n = 1500): CatalogEvent[] {
  const rng = mulberry32(seed);
  const K = 150;
  const c = 0.05;
  const p = 1.1;
  const mags = syntheticGutenbergRichter(n, 1.0, 2.0, 0.1, rng);
  const out: CatalogEvent[] = [ev("main", 0, mainMag)];
  let tau = 0;
  for (let i = 0; i < n; i++) {
    tau += -Math.log(1 - rng());
    const t = ((1 - p) * tau / K + c ** (1 - p)) ** (1 / (1 - p)) - c;
    if (!Number.isFinite(t) || t > 300) break;
    // Keep aftershocks below the mainshock, as a real sequence would.
    const m = Math.min(mags[i]!, mainMag - 0.8);
    out.push(ev(`a${i}`, t, m, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25));
  }
  return out;
}

describe("wellsCoppersmithRuptureKm", () => {
  it("matches the published all-slip-type regression", () => {
    // log10(SRL) = -3.22 + 0.69 Mw
    expect(wellsCoppersmithRuptureKm(7.0)).toBeCloseTo(10 ** (-3.22 + 0.69 * 7), 6);
    expect(wellsCoppersmithRuptureKm(7.0)).toBeGreaterThan(40);
    expect(wellsCoppersmithRuptureKm(7.0)).toBeLessThan(55);
  });
});

describe("sequenceQueryWindow", () => {
  const now = T0 + 1000 * DAY;

  it("scales the radius with magnitude and caps it", () => {
    const small = sequenceQueryWindow(ev("s", 0, 5.0), now);
    const large = sequenceQueryWindow(ev("l", 0, 7.5), now);
    const huge = sequenceQueryWindow(ev("h", 0, 9.1), now);
    expect(large.radiusKm).toBeGreaterThan(small.radiusKm);
    expect(huge.radiusKm).toBeLessThanOrEqual(300);
  });

  it("includes 30 days before the mainshock for foreshocks", () => {
    expect(sequenceQueryWindow(ev("m", 0, 6), now).startMs).toBe(T0 - 30 * DAY);
  });

  it("never extends past now", () => {
    const recent = sequenceQueryWindow(ev("m", 0, 7), T0 + 2 * DAY);
    expect(recent.endMs).toBe(T0 + 2 * DAY);
  });

  it("never extends beyond a year after the mainshock", () => {
    const w = sequenceQueryWindow(ev("m", 0, 8.5), now);
    expect(w.endMs - T0).toBeLessThanOrEqual(365 * DAY);
  });

  it("sets the magnitude floor four units below the mainshock, never below 1.5", () => {
    expect(sequenceQueryWindow(ev("m", 0, 7.1), now).minMagnitude).toBeCloseTo(3.1, 6);
    expect(sequenceQueryWindow(ev("m", 0, 4.5), now).minMagnitude).toBe(1.5);
  });

  it("uses the FDSN per-request maximum as its row limit", () => {
    expect(sequenceQueryWindow(ev("m", 0, 7), now).rowLimit).toBe(20_000);
  });
});

describe("classifySequence", () => {
  it("calls a dominant mainshock a mainshock-aftershock sequence", () => {
    const members = [ev("main", 0, 6.5), ev("a", 1, 5.2), ev("b", 2, 4.8), ev("c", 3, 4.0), ev("d", 4, 3.9)];
    const c = classifySequence(members, "main");
    expect(c.kind).toBe("mainshock-aftershock");
    expect(c.magnitudeGap).toBeCloseTo(1.3, 6);
    expect(c.bathDelta).toBeCloseTo(1.3, 6);
    expect(c.reasons.join(" ")).toMatch(/0\.5/);
  });

  it("calls similar-sized events a swarm", () => {
    const members = Array.from({ length: 12 }, (_, i) => ev(`s${i}`, i, 4.2 + (i % 3) * 0.1));
    expect(classifySequence(members, "s0").kind).toBe("swarm");
  });

  it("calls fewer than five events isolated", () => {
    expect(classifySequence([ev("m", 0, 6), ev("a", 1, 4)], "m").kind).toBe("isolated");
  });

  it("says so when the event opened is not the largest in its sequence", () => {
    const members = [ev("fore", 0, 5.0), ev("main", 2, 7.0), ev("a", 3, 5.5), ev("b", 4, 5), ev("c", 5, 4.5)];
    const c = classifySequence(members, "fore");
    expect(c.largestId).toBe("main");
    expect(c.reasons.join(" ")).toMatch(/larger event/i);
  });
});

describe("analyseSequence", () => {
  const events = syntheticSequence(21);
  const now = T0 + 400 * DAY;
  const analysis = analyseSequence(events[0]!, events, now);

  it("classifies the synthetic sequence correctly", () => {
    expect(analysis.classification.kind).toBe("mainshock-aftershock");
  });

  it("estimates completeness near the synthetic floor of 2.0", () => {
    expect(analysis.mc.used).not.toBeNull();
    expect(analysis.mc.used!).toBeGreaterThanOrEqual(1.9);
    expect(analysis.mc.used!).toBeLessThanOrEqual(2.4);
  });

  it("recovers b near 1 with an interval", () => {
    const b = analysis.bValue.akiUtsu;
    if (isRefusal(b)) throw new Error(b.reason);
    expect(b.b).toBeGreaterThan(0.85);
    expect(b.b).toBeLessThan(1.15);
    expect(b.ci95[1]).toBeGreaterThan(b.ci95[0]);
  });

  it("fits Omori with p near the synthetic 1.1", () => {
    const f = analysis.omori;
    if (isRefusal(f)) throw new Error(f.reason);
    expect(f.p).toBeGreaterThan(0.95);
    expect(f.p).toBeLessThan(1.25);
    expect(analysis.ogata).not.toBeNull();
  });

  it("runs both declustering methods and reports their agreement", () => {
    const d = analysis.declustering;
    expect(d.gardnerKnopoff.method).toBe("gardner-knopoff");
    expect(d.zaliapin.method).toBe("zaliapin-nn");
    expect(d.agreement.both + d.agreement.onlyGk + d.agreement.onlyZbz).toBeGreaterThan(0);
  });

  it("excludes catalogue events outside the radius", () => {
    const far = { ...ev("far", 5, 4.0), lat: 50, lon: 10 };
    const a = analyseSequence(events[0]!, [...events, far], now);
    expect(a.events.some((e) => e.id === "far")).toBe(false);
  });

  it("refuses an Omori fit for a swarm and says why", () => {
    const swarm = Array.from({ length: 200 }, (_, i) => ev(`s${i}`, i * 0.2, 3.0 + (i % 5) * 0.1, (i % 7) * 0.01));
    const a = analyseSequence(swarm[0]!, swarm, T0 + 100 * DAY);
    expect(a.classification.kind).toBe("swarm");
    expect(isRefusal(a.omori)).toBe(true);
    if (isRefusal(a.omori)) expect(a.omori.reason).toMatch(/swarm/i);
  });

  it("refuses every statistic for an isolated event instead of inventing numbers", () => {
    const lone = [ev("m", 0, 5.0), ev("x", 3, 2.0)];
    const a = analyseSequence(lone[0]!, lone, T0 + 50 * DAY);
    expect(a.classification.kind).toBe("isolated");
    expect(isRefusal(a.bValue.akiUtsu)).toBe(true);
    expect(isRefusal(a.omori)).toBe(true);
  });

  it("is deterministic: the same catalogue gives the same page", () => {
    const again = analyseSequence(events[0]!, events, now);
    expect(JSON.stringify(again)).toBe(JSON.stringify(analysis));
  });
});
