import { describe, expect, it } from "vitest";
import { binMagnitudes, cumulativeFromBins, inferBinWidth } from "./magnitude";

describe("inferBinWidth", () => {
  it("detects a catalogue rounded to 0.1", () => {
    expect(inferBinWidth([4.5, 4.6, 4.7, 5.0, 5.3, 4.5])).toBeCloseTo(0.1, 6);
  });
  it("detects a catalogue rounded to 0.01", () => {
    expect(inferBinWidth([4.51, 4.62, 4.73, 5.04])).toBeCloseTo(0.01, 6);
  });
  it("falls back to 0.1 for a sample too small to tell", () => {
    expect(inferBinWidth([5.0])).toBeCloseTo(0.1, 6);
    expect(inferBinWidth([])).toBeCloseTo(0.1, 6);
  });
  it("returns 0.1, not 0, when every magnitude is identical", () => {
    // A zero bin width divides by zero in every downstream estimator.
    expect(inferBinWidth([5, 5, 5, 5])).toBeCloseTo(0.1, 6);
  });
});

describe("binMagnitudes", () => {
  it("counts into bins of the given width", () => {
    const b = binMagnitudes([1.0, 1.04, 1.1, 1.2, 1.2], 0.1);
    expect(b.binWidth).toBeCloseTo(0.1, 6);
    expect(b.counts.reduce((a, c) => a + c, 0)).toBe(5);
    expect(b.edges[0]).toBeCloseTo(1.0, 6);
  });
  it("returns empty structures for an empty input rather than throwing", () => {
    const b = binMagnitudes([]);
    expect(b.counts).toHaveLength(0);
    expect(b.edges).toHaveLength(0);
  });
  it("handles a single repeated magnitude as one bin", () => {
    const b = binMagnitudes([3, 3, 3], 0.1);
    expect(b.counts).toEqual([3]);
  });
});

describe("cumulativeFromBins", () => {
  it("counts events at or above each bin, descending", () => {
    const bins = binMagnitudes([1.0, 1.1, 1.1, 1.2], 0.1);
    const cum = cumulativeFromBins(bins);
    expect(cum[0]).toBe(4);
    expect(cum.at(-1)).toBe(1);
  });
  it("is non-increasing by construction", () => {
    const cum = cumulativeFromBins(binMagnitudes([1, 2, 2, 3, 4, 4, 4], 0.5));
    for (let i = 1; i < cum.length; i++) expect(cum[i]!).toBeLessThanOrEqual(cum[i - 1]!);
  });
});
