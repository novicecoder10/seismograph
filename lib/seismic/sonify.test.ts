import { describe, expect, it } from "vitest";
import type { Trace } from "./miniseed";
import { sonify } from "./sonify";

const makeTrace = (samples: Float32Array, sampleRate = 100): Trace => ({
  network: "AM",
  station: "TEST",
  location: "00",
  channel: "EHZ",
  startTime: new Date("2026-09-20T00:00:00Z"),
  sampleRate,
  samples,
});

const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 7) * 5000);

describe("sonify", () => {
  it("compresses 100 Hz ground motion to 44.1 kHz playback", () => {
    const out = sonify(makeTrace(ramp(6000), 100));
    expect(out.sampleRate).toBe(44100);
    expect(out.speedUp).toBeCloseTo(441, 0);
    expect(out.durationS).toBeCloseTo(6000 / 44100, 4);
  });

  it("reports the true ratio for a 4.5 Hz channel", () => {
    expect(sonify(makeTrace(ramp(900), 4.5)).speedUp).toBeCloseTo(9800, 0);
  });

  it("reports the true ratio for a 20 Hz channel (the SeisSound case)", () => {
    expect(sonify(makeTrace(ramp(900), 20)).speedUp).toBeCloseTo(2205, 0);
  });

  it("normalises to within [-1, 1]", () => {
    const out = sonify(makeTrace(ramp(2000)));
    const max = Array.from(out.samples).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max).toBeGreaterThan(0.9);
  });

  it("fills gaps with silence rather than clicks", () => {
    const s = ramp(2000);
    s.fill(NaN, 800, 900);
    const out = sonify(makeTrace(s));
    expect(Array.from(out.samples).every(Number.isFinite)).toBe(true);
    for (let i = 810; i < 890; i++) expect(out.samples[i]).toBe(0);
  });

  it("removes a constant DC offset instead of clipping on it", () => {
    const s = Float32Array.from({ length: 1000 }, (_, i) => 100_000 + Math.sin(i / 5) * 10);
    const out = sonify(makeTrace(s));
    const mean = Array.from(out.samples).reduce((a, b) => a + b, 0) / out.samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
  });

  it("returns silence for a dead channel rather than dividing by zero", () => {
    const out = sonify(makeTrace(new Float32Array(1000)));
    expect(Array.from(out.samples).every((v) => v === 0)).toBe(true);
  });

  it("returns silence for an all-gap trace", () => {
    const out = sonify(makeTrace(new Float32Array(500).fill(NaN)));
    expect(Array.from(out.samples).every((v) => v === 0)).toBe(true);
  });

  it("rejects an empty trace", () => {
    expect(() => sonify(makeTrace(new Float32Array(0)))).toThrow(/empty/);
  });

  it("rejects a zero or negative sample rate", () => {
    expect(() => sonify(makeTrace(ramp(100), 0))).toThrow(/sample rate/);
  });
});
