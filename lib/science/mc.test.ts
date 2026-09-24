import { describe, expect, it } from "vitest";
import { mcGft, mcMaxc, mcOverTime, mcSpatial } from "./mc";
import { mulberry32, syntheticGutenbergRichter } from "./random";
import { isRefusal } from "./refusal";

/** A catalogue complete above `mcTrue`, with detection falling off below it
 *  as a normal CDF — the standard model of network detection.
 *
 *  `n` is the count BEFORE detection. Events are drawn from 1.5 units below Mc,
 *  so detection keeps only ~6%: n = 20,000 yields ~1,200 events. */
function withIncompleteness(n: number, mcTrue: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const all = syntheticGutenbergRichter(n, 1.0, mcTrue - 1.5, 0.1, rng);
  return all.filter((m) => {
    if (m >= mcTrue) return true;
    const z = (m - (mcTrue - 0.3)) / 0.15;
    const detect = 0.5 * (1 + Math.tanh(z * 0.8));
    return rng() < detect;
  });
}

const ok = <T>(v: T) => {
  if (isRefusal(v)) throw new Error(v.reason);
  return v as Exclude<T, { refused: true }>;
};

describe("mcMaxc", () => {
  it("finds a completeness near the true value, with the +0.2 correction", () => {
    const est = ok(mcMaxc(withIncompleteness(20000, 2.0, 1)));
    expect(est.mc).toBeGreaterThanOrEqual(1.7);
    expect(est.mc).toBeLessThanOrEqual(2.3);
  });

  it("reports a bootstrap uncertainty, reproducibly", () => {
    const mags = withIncompleteness(5000, 2.0, 2);
    const a = ok(mcMaxc(mags, { seed: 7 }));
    const b = ok(mcMaxc(mags, { seed: 7 }));
    expect(a.sigma).toBeGreaterThanOrEqual(0);
    expect(a.sigma).toBe(b.sigma);
  });

  it("refuses a catalogue too small to have a meaningful mode", () => {
    expect(isRefusal(mcMaxc([2, 2.1, 2.2]))).toBe(true);
  });
});

describe("mcGft", () => {
  it("finds a completeness near the true value", () => {
    const est = ok(mcGft(withIncompleteness(20000, 2.0, 3)));
    expect(est.mc).toBeGreaterThanOrEqual(1.7);
    expect(est.mc).toBeLessThanOrEqual(2.4);
  });

  it("is labelled so the two methods can be shown side by side", () => {
    expect(ok(mcGft(withIncompleteness(5000, 2, 4))).method).toBe("gft");
    expect(ok(mcMaxc(withIncompleteness(5000, 2, 4))).method).toBe("maxc");
  });

  it("refuses when no magnitude reaches the goodness-of-fit level", () => {
    // A flat, non-Gutenberg-Richter distribution.
    const flat = Array.from({ length: 600 }, (_, i) => 2 + (i % 30) * 0.1);
    const r = mcGft(flat);
    expect(isRefusal(r)).toBe(true);
  });
});

describe("mcOverTime", () => {
  it("shows completeness improving when the network densifies", () => {
    const early = withIncompleteness(20000, 2.5, 5);
    const late = withIncompleteness(20000, 1.5, 6);
    const events = [
      ...early.map((magnitude, i) => ({ time: i * 1000, magnitude })),
      ...late.map((magnitude, i) => ({ time: 10_000_000 + i * 1000, magnitude })),
    ];
    const series = mcOverTime(events, { window: 400, step: 200 });
    expect(series.length).toBeGreaterThan(4);
    expect(series[0]!.mc).toBeGreaterThan(series.at(-1)!.mc + 0.5);
    for (const s of series) expect(s.sigma).toBeGreaterThanOrEqual(0);
  });

  it("returns nothing for a catalogue smaller than one window", () => {
    expect(mcOverTime([{ time: 0, magnitude: 2 }], { window: 200 })).toHaveLength(0);
  });

  it("orders its output by time regardless of input order", () => {
    const mags = withIncompleteness(20000, 2, 7);
    const events = mags.map((magnitude, i) => ({ time: (mags.length - i) * 1000, magnitude }));
    const series = mcOverTime(events, { window: 300, step: 150 });
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.timeMs).toBeGreaterThanOrEqual(series[i - 1]!.timeMs);
    }
  });
});

describe("mcSpatial", () => {
  it("resolves a better-instrumented cell from a worse one", () => {
    const good = withIncompleteness(20000, 1.5, 8).map((magnitude) => ({ lat: 34.1, lon: -118.1, magnitude }));
    const poor = withIncompleteness(20000, 3.0, 9).map((magnitude) => ({ lat: 36.1, lon: -118.1, magnitude }));
    const cells = mcSpatial([...good, ...poor], { cellDeg: 1, minPerCell: 100 });
    const south = cells.find((c) => c.lat < 35)!;
    const north = cells.find((c) => c.lat > 35)!;
    expect(north.mc).toBeGreaterThan(south.mc + 0.8);
  });

  it("omits cells with too few events rather than estimating from noise", () => {
    const sparse = [{ lat: 0, lon: 0, magnitude: 3 }];
    expect(mcSpatial(sparse, { minPerCell: 50 })).toHaveLength(0);
  });
});
