import { describe, expect, it } from "vitest";
import { audioSamples, MAX_BUFFER_RATE, panFromAzimuth, playbackPlan, sweepCurve, vcoCurve } from "./audio";

describe("audio", () => {
  it("declares the sped-up rate and decimates only when it must", () => {
    expect(playbackPlan(20, 1000)).toEqual({ declaredRate: 20000, decimate: 1 });
    const p = playbackPlan(100, 10000);
    expect(p.declaredRate).toBeLessThanOrEqual(MAX_BUFFER_RATE);
    expect((p.declaredRate * p.decimate) / 100).toBeCloseTo(10000, 6); // speed preserved
  });

  it("normalises, removes gaps and decimates", () => {
    const s = audioSamples(Float32Array.from([0, 2, NaN, -4, 1, 0]), 2);
    expect(Array.from(s)).toEqual([0, 0, 1]); // keeps samples 0, 2, 4
  });

  it("pans east right and west left", () => {
    expect(panFromAzimuth(90)).toBeCloseTo(1, 12);
    expect(panFromAzimuth(270)).toBeCloseTo(-1, 12);
    expect(panFromAzimuth(0)).toBeCloseTo(0, 12);
  });

  it("the VCO follows long-period motion and ignores short-period", () => {
    const fs = 20, n = 20 * 600;
    const slow = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 0.01 * i) / fs));
    const fast = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 5 * i) / fs));
    const cs = vcoCurve(slow, fs, { baseHz: 220, octaves: 1 });
    expect(Math.max(...cs)).toBeGreaterThan(400);
    expect(Math.min(...cs)).toBeLessThan(120);
    const cf = vcoCurve(fast, fs, { baseHz: 220, octaves: 1 });
    // Normalised to its own tiny residual, but centred on the base pitch.
    expect(cf.reduce((a, b) => a + b, 0) / cf.length).toBeGreaterThan(180);
    expect(vcoCurve(new Float32Array(100), fs).every((v) => v === 220)).toBe(true);
  });

  it("sweeps logarithmically between its ends", () => {
    const c = sweepCurve(60, 8000, 3);
    expect(c[0]).toBeCloseTo(60, 6);
    expect(c[1]).toBeCloseTo(Math.sqrt(60 * 8000), 3);
    expect(c[2]).toBeCloseTo(8000, 3);
  });
});
