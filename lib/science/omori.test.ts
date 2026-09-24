import { describe, expect, it } from "vitest";
import { fitOmori, MIN_EVENTS_FOR_OMORI, ogataResiduals, omoriIntegral, omoriRate } from "./omori";
import { mulberry32 } from "./random";
import { isRefusal } from "./refusal";

/** Aftershock times (days) drawn from a known Omori-Utsu process, by inverting
 *  the cumulative rate: unit-rate Poisson arrivals in transformed time map back
 *  through Λ⁻¹. */
function synthetic(K: number, c: number, p: number, T: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  let tau = 0;
  for (;;) {
    tau += -Math.log(1 - rng());
    const t = ((1 - p) * tau / K + c ** (1 - p)) ** (1 / (1 - p)) - c;
    if (!Number.isFinite(t) || t > T) break;
    out.push(t);
  }
  return out;
}

const fit = (times: number[], T: number) => {
  const r = fitOmori(times, { startDays: 0, endDays: T });
  if (isRefusal(r)) throw new Error(r.reason);
  return r;
};

describe("omoriIntegral", () => {
  it("matches the p = 1 closed form", () => {
    expect(omoriIntegral(0.1, 1, 0, 10)).toBeCloseTo(Math.log(10.1 / 0.1), 10);
  });
  it("is continuous through p = 1", () => {
    const below = omoriIntegral(0.1, 0.999999, 0, 10);
    const at = omoriIntegral(0.1, 1, 0, 10);
    expect(below).toBeCloseTo(at, 3);
  });
  it("matches numerical integration for p != 1", () => {
    let sum = 0;
    const steps = 200_000;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * (10 / steps);
      sum += (t + 0.05) ** -1.2 * (10 / steps);
    }
    expect(omoriIntegral(0.05, 1.2, 0, 10)).toBeCloseTo(sum, 3);
  });
});

describe("fitOmori", () => {
  const K = 200;
  const c = 0.05;
  const p = 1.1;
  const T = 100;
  const times = synthetic(K, c, p, T, 11);

  it("generates a synthetic sequence of the expected size", () => {
    // n ≈ K·I(c, p, 0, T) ≈ 1436.
    expect(times.length).toBeGreaterThan(1300);
    expect(times.length).toBeLessThan(1600);
  });

  it("recovers p", () => {
    const f = fit(times, T);
    expect(f.p).toBeGreaterThan(p - 0.07);
    expect(f.p).toBeLessThan(p + 0.07);
    expect(f.ci95P).not.toBeNull();
  });

  it("reports error bars of the right size: 95% intervals cover the truth ~95% of the time", () => {
    // A single seed is one random draw, and ~1 in 20 legitimately falls outside
    // its 95% interval — the first version of this test used seed 11, which is
    // one of them (p = 1.142, 2.1σ out). The claim worth testing is calibration:
    // over many sequences the estimator is unbiased, its reported σ matches the
    // actual spread, and its interval covers the truth at the stated rate.
    const ps: number[] = [];
    const sigmas: number[] = [];
    let covered = 0;
    const runs = 120;
    for (let seed = 100; seed < 100 + runs; seed++) {
      const f = fit(synthetic(K, c, p, T, seed), T);
      ps.push(f.p);
      sigmas.push(f.sigma!.p);
      if (f.ci95P![0] < p && f.ci95P![1] > p) covered++;
    }
    const mean = ps.reduce((a, v) => a + v, 0) / runs;
    const sd = Math.sqrt(ps.reduce((a, v) => a + (v - mean) ** 2, 0) / (runs - 1));
    const meanSigma = sigmas.reduce((a, v) => a + v, 0) / runs;
    console.log(
      `p calibration over ${runs} sequences: mean ${mean.toFixed(4)}, spread ${sd.toFixed(4)}, ` +
        `reported sigma ${meanSigma.toFixed(4)}, coverage ${covered}/${runs}`,
    );
    expect(Math.abs(mean - p)).toBeLessThan(0.01);
    expect(meanSigma / sd).toBeGreaterThan(0.8);
    expect(meanSigma / sd).toBeLessThan(1.25);
    expect(covered / runs).toBeGreaterThan(0.88);
    expect(covered / runs).toBeLessThan(0.995);
  });

  it("recovers c within a factor of two", () => {
    const f = fit(times, T);
    expect(f.c).toBeGreaterThan(c / 2);
    expect(f.c).toBeLessThan(c * 2);
  });

  it("recovers K within 25%", () => {
    const f = fit(times, T);
    expect(f.K).toBeGreaterThan(K * 0.75);
    expect(f.K).toBeLessThan(K * 1.25);
  });

  it("reports an uncertainty for every parameter", () => {
    const f = fit(times, T);
    expect(f.sigma).not.toBeNull();
    for (const v of [f.sigma!.K, f.sigma!.c, f.sigma!.p]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("recovers p = 0.9, below unity", () => {
    const f = fit(synthetic(150, 0.02, 0.9, 200, 12), 200);
    expect(f.p).toBeCloseTo(0.9, 1);
  });

  it("fits so that the expected count equals the observed count", () => {
    const f = fit(times, T);
    expect(f.K * omoriIntegral(f.c, f.p, 0, T)).toBeCloseTo(f.n, 6);
  });

  it("tolerates an event at exactly t = 0 without an infinite likelihood", () => {
    const f = fit([0, ...times], T);
    expect(Number.isFinite(f.logLikelihood)).toBe(true);
  });

  it("tolerates unsorted input and exact ties", () => {
    const shuffled = [...times].reverse();
    shuffled.push(times[10]!, times[10]!);
    const f = fit(shuffled, T);
    expect(Number.isFinite(f.p)).toBe(true);
  });

  it(`refuses with fewer than ${MIN_EVENTS_FOR_OMORI} events`, () => {
    const r = fitOmori(times.slice(0, 10), { endDays: T });
    expect(isRefusal(r)).toBe(true);
    if (isRefusal(r)) expect(r.reason).toMatch(/at least 20/);
  });

  it("ignores events outside the fitting window", () => {
    const f1 = fit(times, 50);
    const f2 = fit(times.filter((t) => t <= 50), 50);
    expect(f1.n).toBe(f2.n);
    expect(f1.p).toBeCloseTo(f2.p, 6);
  });

  it("gives a rate that decays", () => {
    const f = fit(times, T);
    expect(omoriRate(f, 1)).toBeGreaterThan(omoriRate(f, 10));
  });
});

describe("ogataResiduals", () => {
  const T = 100;
  const clean = synthetic(200, 0.05, 1.1, T, 13);

  it("finds a clean Omori sequence consistent with the model", () => {
    const f = fitOmori(clean, { endDays: T });
    if (isRefusal(f)) throw new Error(f.reason);
    const r = ogataResiduals(clean, f);
    expect(r.total).toBeCloseTo(f.n, 6);
    expect(r.consistent).toBe(true);
    expect(r.points).toHaveLength(f.n);
  });

  it("flags a secondary burst the Omori model cannot explain", () => {
    // 200 extra events in half a day at t = 40: a secondary sequence.
    const rng = mulberry32(14);
    const burst = Array.from({ length: 200 }, () => 40 + rng() * 0.5);
    const times = [...clean, ...burst];
    const f = fitOmori(times, { endDays: T });
    if (isRefusal(f)) throw new Error(f.reason);
    const r = ogataResiduals(times, f);
    expect(r.consistent).toBe(false);
    expect(r.ks).toBeGreaterThan(r.ksCritical95);
  });

  it("produces transformed times that are non-decreasing", () => {
    const f = fitOmori(clean, { endDays: T });
    if (isRefusal(f)) throw new Error(f.reason);
    const taus = ogataResiduals(clean, f).points.map((p) => p.tau);
    for (let i = 1; i < taus.length; i++) expect(taus[i]!).toBeGreaterThanOrEqual(taus[i - 1]!);
  });
});
