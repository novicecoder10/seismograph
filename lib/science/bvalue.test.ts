import { describe, expect, it } from "vitest";
import { akiUtsu, bPositive, MIN_EVENTS_FOR_B } from "./bvalue";
import { mulberry32, syntheticGutenbergRichter } from "./random";
import { isRefusal } from "./refusal";

const ok = <T>(v: T) => {
  if (isRefusal(v)) throw new Error(`unexpected refusal: ${v.reason}`);
  return v as Exclude<T, { refused: true }>;
};

describe("akiUtsu", () => {
  it("recovers b = 1.0 from a synthetic catalogue, with the truth inside its interval", () => {
    const mags = syntheticGutenbergRichter(5000, 1.0, 2.0, 0.1, mulberry32(1));
    const est = ok(akiUtsu(mags, 2.0, 0.1));
    expect(est.b).toBeGreaterThan(0.95);
    expect(est.b).toBeLessThan(1.05);
    expect(est.ci95[0]).toBeLessThan(1.0);
    expect(est.ci95[1]).toBeGreaterThan(1.0);
  });

  it("recovers b = 1.5", () => {
    const mags = syntheticGutenbergRichter(5000, 1.5, 3.0, 0.1, mulberry32(2));
    expect(ok(akiUtsu(mags, 3.0, 0.1)).b).toBeCloseTo(1.5, 1);
  });

  it("matches the closed form for a known mean", () => {
    // Mc 2.0, ΔM 0.1, mean 2.4: b = log10(e) / (2.4 - 1.95) = 0.96509...
    const mags = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 2.0 : 2.8));
    const est = ok(akiUtsu(mags, 2.0, 0.1));
    expect(est.b).toBeCloseTo(Math.LOG10E / (2.4 - 1.95), 6);
  });

  it("computes the Shi-Bolt uncertainty exactly", () => {
    const mags = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 2.0 : 2.8));
    const est = ok(akiUtsu(mags, 2.0, 0.1));
    const n = 100;
    const mean = 2.4;
    const ss = mags.reduce((a, m) => a + (m - mean) ** 2, 0);
    const expected = 2.3 * est.b ** 2 * Math.sqrt(ss / (n * (n - 1)));
    expect(est.sigma).toBeCloseTo(expected, 10);
  });

  it("narrows its uncertainty roughly as 1/sqrt(n)", () => {
    const rng = mulberry32(3);
    const small = ok(akiUtsu(syntheticGutenbergRichter(1000, 1, 2, 0.1, rng), 2, 0.1));
    const large = ok(akiUtsu(syntheticGutenbergRichter(4000, 1, 2, 0.1, rng), 2, 0.1));
    expect(large.sigma / small.sigma).toBeGreaterThan(0.4);
    expect(large.sigma / small.sigma).toBeLessThan(0.6);
  });

  it("always reports a 95% interval symmetric about b", () => {
    const est = ok(akiUtsu(syntheticGutenbergRichter(500, 1, 2, 0.1, mulberry32(4)), 2, 0.1));
    expect(est.b - est.ci95[0]).toBeCloseTo(1.96 * est.sigma, 10);
    expect(est.ci95[1] - est.b).toBeCloseTo(1.96 * est.sigma, 10);
  });

  it("ignores events below Mc", () => {
    const above = syntheticGutenbergRichter(800, 1, 2, 0.1, mulberry32(5));
    const withNoise = [...above, ...Array.from({ length: 500 }, () => 1.2)];
    expect(ok(akiUtsu(withNoise, 2, 0.1)).b).toBeCloseTo(ok(akiUtsu(above, 2, 0.1)).b, 10);
  });

  it(`refuses with fewer than ${MIN_EVENTS_FOR_B} events above Mc`, () => {
    const r = akiUtsu(syntheticGutenbergRichter(30, 1, 2, 0.1, mulberry32(6)), 2, 0.1);
    expect(isRefusal(r)).toBe(true);
    if (isRefusal(r)) expect(r.reason).toMatch(/at least 50/);
  });

  it("refuses when every magnitude above Mc is identical, rather than claiming certainty", () => {
    const r = akiUtsu(new Array(200).fill(3.0), 3.0, 0.1);
    expect(isRefusal(r)).toBe(true);
    if (isRefusal(r)) expect(r.reason).toMatch(/do not vary/);
  });

  it("refuses an empty catalogue", () => {
    expect(isRefusal(akiUtsu([], 2, 0.1))).toBe(true);
  });
});

describe("bPositive", () => {
  const DAY = 86_400_000;

  it("recovers b on a complete catalogue, agreeing with Aki-Utsu", () => {
    const mags = syntheticGutenbergRichter(4000, 1.0, 1.0, 0.1, mulberry32(7));
    const events = mags.map((magnitude, i) => ({ time: i * DAY, magnitude }));
    const est = ok(bPositive(events, { binWidth: 0.1, dc: 0.2 }));
    expect(est.method).toBe("b-positive");
    expect(est.b).toBeGreaterThan(0.9);
    expect(est.b).toBeLessThan(1.1);
  });

  it("resists short-term incompleteness that biases Aki-Utsu low", () => {
    // After a large event, completeness is temporarily raised: small events are
    // buried in the coda. The published premise (van der Elst 2021) is a
    // completeness THRESHOLD Mc(t) that varies slowly relative to event spacing —
    // so consecutive events see the same threshold, and an increase above an
    // already-detected event is itself detected. Model exactly that: a raised
    // threshold early, then a lower one.
    //
    // (An earlier version of this test thinned small events at random instead.
    // That distorts the magnitude distribution itself, which no estimator can see
    // through, and b-positive rightly did no better there.)
    //
    // The incomplete period must also be where the rate is HIGHEST, as it is
    // after a real mainshock: otherwise it holds too few events to bias anything.
    // So 6,000 events arrive under Mc 2.0, then 3,000 under Mc 1.0.
    const rng = mulberry32(8);
    const early = syntheticGutenbergRichter(6000, 1.0, 1.0, 0.1, rng).filter((m) => m >= 2.0 - 1e-9);
    const late = syntheticGutenbergRichter(3000, 1.0, 1.0, 0.1, rng);
    const events = [...early, ...late].map((magnitude, i) => ({ time: i * DAY, magnitude }));
    const aki = ok(akiUtsu(events.map((e) => e.magnitude), 1.0, 0.1));
    const pos = ok(bPositive(events, { binWidth: 0.1, dc: 0.2 }));
    expect(aki.b).toBeLessThan(0.85);
    expect(Math.abs(pos.b - 1.0)).toBeLessThan(Math.abs(aki.b - 1.0));
    expect(Math.abs(pos.b - 1.0)).toBeLessThan(0.08);
  });

  it("orders by time itself, so an unsorted input gives the same answer", () => {
    const mags = syntheticGutenbergRichter(1000, 1.0, 1.0, 0.1, mulberry32(9));
    const events = mags.map((magnitude, i) => ({ time: i * DAY, magnitude }));
    const shuffled = [...events].sort((a, b) => (a.magnitude * 7919 + a.time) % 13 - (b.magnitude * 7919 + b.time) % 13);
    expect(ok(bPositive(shuffled)).b).toBeCloseTo(ok(bPositive(events)).b, 10);
  });

  it("refuses when too few positive differences exceed the threshold", () => {
    const events = Array.from({ length: 40 }, (_, i) => ({ time: i, magnitude: 3 + (i % 2) * 0.5 }));
    expect(isRefusal(bPositive(events))).toBe(true);
  });
});
