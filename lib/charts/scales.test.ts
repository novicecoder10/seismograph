import { describe, expect, it } from "vitest";
import { linearScale, logBins, logScale } from "./scales";

describe("linearScale", () => {
  const s = linearScale([0, 10], [0, 100]);
  it("maps the domain onto the range", () => {
    expect(s(0)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(100);
  });
  it("supports an inverted range, as SVG y axes need", () => {
    const y = linearScale([0, 1], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(1)).toBe(0);
  });
  it("produces round ticks inside the domain", () => {
    for (const t of s.ticks) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(10);
    }
    expect(s.ticks.length).toBeGreaterThanOrEqual(3);
  });
  it("does not divide by zero on a degenerate domain", () => {
    const d = linearScale([5, 5], [0, 100]);
    expect(Number.isFinite(d(5))).toBe(true);
  });
});

describe("logScale", () => {
  const s = logScale([1, 1000], [0, 300]);
  it("places each decade at an equal interval", () => {
    expect(s(1)).toBeCloseTo(0, 6);
    expect(s(10)).toBeCloseTo(100, 6);
    expect(s(100)).toBeCloseTo(200, 6);
  });
  it("puts ticks at the powers of ten", () => {
    expect(s.ticks).toEqual([1, 10, 100, 1000]);
  });
  it("clamps non-positive values instead of returning NaN", () => {
    expect(Number.isFinite(s(0))).toBe(true);
    expect(Number.isFinite(s(-5))).toBe(true);
  });
});

describe("logBins", () => {
  it("spaces bin edges evenly in log time", () => {
    const edges = logBins(0.01, 100, 4);
    expect(edges[0]).toBeCloseTo(0.01, 9);
    expect(edges.at(-1)!).toBeGreaterThanOrEqual(100);
    const ratios = edges.slice(1).map((e, i) => e / edges[i]!);
    for (const r of ratios) expect(r).toBeCloseTo(10 ** 0.25, 6);
  });
});
