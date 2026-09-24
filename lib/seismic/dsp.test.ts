import { describe, expect, it } from "vitest";
import { bandpass, detrend, envelope, rotateToNorthEast, taper } from "./dsp";

const sine = (f: number, fs: number, n: number, amp = 1) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / fs));
const rms = (x: Float32Array, from = 0, to = x.length) => Math.sqrt(x.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));

describe("dsp", () => {
  it("detrend removes a line and fills gaps with zero", () => {
    const x = Float32Array.from({ length: 100 }, (_, i) => 3 + 0.5 * i);
    x[10] = NaN;
    const y = detrend(x);
    expect(Math.max(...Array.from(y).map(Math.abs))).toBeLessThan(1e-3);
  });

  it("taper zeroes the ends and keeps the middle", () => {
    const y = taper(new Float32Array(100).fill(1));
    expect(y[0]).toBe(0);
    expect(y[50]).toBe(1);
  });

  it("band-pass keeps in-band and rejects out-of-band", () => {
    const fs = 20, n = 4000;
    const inBand = bandpass(sine(1, fs, n), fs, 0.5, 2);
    const low = bandpass(sine(0.02, fs, n), fs, 0.5, 2);
    const high = bandpass(sine(8, fs, n), fs, 0.5, 2);
    expect(rms(inBand, 500, 3500)).toBeGreaterThan(0.6);
    expect(rms(low, 500, 3500)).toBeLessThan(0.02);
    expect(rms(high, 500, 3500)).toBeLessThan(0.05);
  });

  it("band-pass is zero-phase: a pulse stays where it was", () => {
    const x = new Float32Array(2000);
    x[1000] = 1;
    const y = bandpass(x, 20, 0.2, 2);
    let at = 0;
    y.forEach((v, i) => { if (Math.abs(v) > Math.abs(y[at]!)) at = i; });
    expect(at).toBe(1000);
  });

  it("ignores limits at or above Nyquist", () => {
    const x = sine(1, 20, 400);
    expect(Array.from(bandpass(x, 20, null, 50))).toEqual(Array.from(x));
  });

  it("envelope is normalised peak per window", () => {
    const e = envelope(Float32Array.from([0, 1, -4, 2, 0, 0]), 2);
    expect(Array.from(e)).toEqual([0.25, 1, 0]);
  });

  it("rotates sensors at 0/90 as identity and at 180/270 as negation", () => {
    const a = Float32Array.from([1, 2]), b = Float32Array.from([3, 4]);
    const id = rotateToNorthEast(a, 0, b, 90);
    expect(Array.from(id.north)).toEqual([1, 2]);
    expect(Array.from(id.east).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([3, 4]);
    const neg = rotateToNorthEast(a, 180, b, 270);
    expect(Array.from(neg.north).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-1, -2]);
  });

  it("recovers north motion from sensors at 160/250", () => {
    const north = 5;
    const r1 = (160 * Math.PI) / 180, r2 = (250 * Math.PI) / 180;
    const h1 = Float32Array.of(north * Math.cos(r1)), h2 = Float32Array.of(north * Math.cos(r2));
    const r = rotateToNorthEast(h1, 160, h2, 250);
    expect(r.north[0]).toBeCloseTo(5, 5);
    expect(r.east[0]).toBeCloseTo(0, 5);
  });
});
