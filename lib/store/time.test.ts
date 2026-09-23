import { beforeEach, describe, expect, it } from "vitest";
import { clampRate, clampT, MAX_RATE, MIN_RATE, useTimeStore } from "./time";

const RANGE = { startMs: Date.UTC(2026, 8, 16), endMs: Date.UTC(2026, 8, 23) };

describe("clampT", () => {
  it("keeps t inside the range", () => {
    expect(clampT(RANGE.startMs - 1_000, RANGE)).toBe(RANGE.startMs);
    expect(clampT(RANGE.endMs + 1_000, RANGE)).toBe(RANGE.endMs);
    expect(clampT(RANGE.startMs + 5_000, RANGE)).toBe(RANGE.startMs + 5_000);
  });

  it("returns a value inside the range for NaN, Infinity and absurd numbers", () => {
    for (const bad of [NaN, Infinity, -Infinity, 1e30, -1e30]) {
      const out = clampT(bad, RANGE);
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(RANGE.startMs);
      expect(out).toBeLessThanOrEqual(RANGE.endMs);
    }
  });

  it("handles an inverted range without returning NaN", () => {
    const inverted = { startMs: RANGE.endMs, endMs: RANGE.startMs };
    const out = clampT(Date.UTC(2026, 8, 20), inverted);
    expect(Number.isFinite(out)).toBe(true);
    expect(out).toBeGreaterThanOrEqual(RANGE.startMs);
    expect(out).toBeLessThanOrEqual(RANGE.endMs);
  });
});

describe("clampRate", () => {
  it("clamps into [MIN_RATE, MAX_RATE]", () => {
    expect(clampRate(0)).toBe(MIN_RATE);
    expect(clampRate(-5)).toBe(MIN_RATE);
    expect(clampRate(MAX_RATE * 10)).toBe(MAX_RATE);
    expect(clampRate(3600)).toBe(3600);
  });

  it("returns MIN_RATE for NaN rather than freezing the clock", () => {
    expect(clampRate(NaN)).toBe(MIN_RATE);
    expect(clampRate(Infinity)).toBe(MAX_RATE);
  });
});

describe("useTimeStore", () => {
  beforeEach(() => {
    useTimeStore.setState({
      t: RANGE.endMs,
      rate: 1,
      playing: false,
      followLive: true,
      range: RANGE,
      lastTickMs: null,
    });
  });

  it("setT clamps into the range", () => {
    useTimeStore.getState().setT(RANGE.endMs + 999_999);
    expect(useTimeStore.getState().t).toBe(RANGE.endMs);
  });

  it("setT turns off followLive: a manual scrub is a deliberate detach", () => {
    useTimeStore.getState().setT(RANGE.startMs + 1000);
    expect(useTimeStore.getState().followLive).toBe(false);
  });

  it("tick advances t by the wall-clock delta times the rate", () => {
    const s = useTimeStore.getState();
    s.setT(RANGE.startMs);
    s.setRate(60);
    s.play();
    const t0 = useTimeStore.getState().t;
    useTimeStore.getState().tick(1000); // establishes the baseline
    useTimeStore.getState().tick(2000); // advances by 1000ms * 60
    expect(useTimeStore.getState().t).toBe(t0 + 60_000);
  });

  it("tick does nothing while paused", () => {
    const s = useTimeStore.getState();
    s.setT(RANGE.startMs);
    s.pause();
    s.tick(1000);
    s.tick(2000);
    expect(useTimeStore.getState().t).toBe(RANGE.startMs);
  });

  it("ignores a backwards or zero wall-clock delta", () => {
    const s = useTimeStore.getState();
    s.setT(RANGE.startMs);
    s.setRate(60);
    s.play();
    useTimeStore.getState().tick(5000);
    useTimeStore.getState().tick(1000);
    expect(useTimeStore.getState().t).toBe(RANGE.startMs);
  });

  it("stops at the range end and pauses rather than running past it", () => {
    const s = useTimeStore.getState();
    s.setT(RANGE.endMs - 10);
    s.setRate(MAX_RATE);
    s.play();
    useTimeStore.getState().tick(0);
    useTimeStore.getState().tick(1000);
    const after = useTimeStore.getState();
    expect(after.t).toBe(RANGE.endMs);
    expect(after.playing).toBe(false);
  });

  it("pressing play at the range end restarts from the start", () => {
    const s = useTimeStore.getState();
    s.setT(RANGE.endMs);
    s.play();
    const after = useTimeStore.getState();
    expect(after.playing).toBe(true);
    expect(after.t).toBe(RANGE.startMs);
  });

  it("setRange clamps t into the new range", () => {
    const s = useTimeStore.getState();
    s.setT(RANGE.endMs);
    s.setRange({ startMs: RANGE.startMs, endMs: RANGE.startMs + 1000 });
    expect(useTimeStore.getState().t).toBe(RANGE.startMs + 1000);
  });
});
