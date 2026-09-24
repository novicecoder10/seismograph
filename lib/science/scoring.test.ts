import { describe, expect, it } from "vitest";
import { bootstrapMean, informationGain, logLoss, mixtureCdf, mixturePmf, nTest, wilson } from "./scoring";

const poisson = (lam: number) => ({ lambdas: [lam], weights: [1] });

describe("scoring", () => {
  it("a single-component mixture is a Poisson", () => {
    expect(mixturePmf(poisson(2), 0)).toBeCloseTo(Math.exp(-2), 12);
    expect(mixturePmf(poisson(2), 3)).toBeCloseTo((8 / 6) * Math.exp(-2), 12);
    expect(mixtureCdf(poisson(2), 1)).toBeCloseTo(3 * Math.exp(-2), 12);
  });

  it("a mixture is the weighted sum of its components", () => {
    const m = { lambdas: [1, 5], weights: [0.3, 0.7] };
    expect(mixturePmf(m, 2)).toBeCloseTo(0.3 * mixturePmf(poisson(1), 2) + 0.7 * mixturePmf(poisson(5), 2), 12);
  });

  it("N-test passes a typical count and fails an extreme one on the correct side", () => {
    expect(nTest(poisson(4), 4).pass).toBe(true);
    const tooMany = nTest(poisson(1), 9);
    expect(tooMany.pass).toBe(false);
    expect(tooMany.pAtLeast).toBeLessThan(0.025);
    const tooFew = nTest(poisson(30), 10);
    expect(tooFew.pass).toBe(false);
    expect(tooFew.pAtMost).toBeLessThan(0.025);
    // Zero observed: P(N >= 0) is 1.
    expect(nTest(poisson(0.1), 0).pAtLeast).toBeCloseTo(1, 12);
  });

  it("information gain is zero against itself and positive for the better model", () => {
    expect(informationGain(poisson(3), 3, 2)).toBeCloseTo(0, 12);
    expect(informationGain(poisson(5), 0.5, 5)).toBeGreaterThan(0);
    expect(informationGain(poisson(0.5), 5, 5)).toBeLessThan(0);
  });

  it("log-loss is finite at certainty", () => {
    expect(logLoss(0.5, true)).toBeCloseTo(Math.LN2, 12);
    expect(Number.isFinite(logLoss(0, true))).toBe(true);
    expect(logLoss(0.9, false)).toBeGreaterThan(logLoss(0.1, false));
  });

  it("Wilson interval contains the proportion and stays in [0, 1]", () => {
    const [lo, hi] = wilson(3, 10);
    expect(lo).toBeLessThan(0.3);
    expect(hi).toBeGreaterThan(0.3);
    expect(wilson(0, 5)[0]).toBe(0);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });

  it("bootstrap interval brackets the mean and is reproducible", () => {
    const v = Array.from({ length: 50 }, (_, i) => (i % 7) - 3);
    const a = bootstrapMean(v, { seed: 3 })!;
    expect(a.ci95[0]).toBeLessThanOrEqual(a.mean);
    expect(a.ci95[1]).toBeGreaterThanOrEqual(a.mean);
    expect(bootstrapMean(v, { seed: 3 })).toEqual(a);
    expect(bootstrapMean([])).toBeNull();
  });
});
