import { describe, expect, it } from "vitest";
import type { Event } from "@/lib/events/types";
import { EARTH_RADIUS_KM } from "@/lib/geo/project";
import {
  buildHypocenterBuffers,
  decodeId,
  MAX_PICKABLE_EVENTS,
  toShaderTime,
} from "./hypocenters";

const ev = (over: Partial<Event> = {}): Event => ({
  id: "usgs:x",
  source: "usgs",
  sourceId: "x",
  time: 1_790_136_000_000,
  lat: 0,
  lon: 0,
  depthKm: 10,
  magnitude: 5,
  magType: "mww",
  place: "p",
  status: "reviewed",
  felt: null,
  cdi: null,
  mmi: null,
  alert: null,
  tsunami: false,
  sig: null,
  url: null,
  ...over,
});

describe("buildHypocenterBuffers", () => {
  it("produces one position triple and one id triple per event", () => {
    const b = buildHypocenterBuffers([ev(), ev({ id: "usgs:y" })]);
    expect(b.count).toBe(2);
    expect(b.positions).toHaveLength(6);
    expect(b.ids).toHaveLength(6);
    expect(b.magnitudes).toHaveLength(2);
    expect(b.depths).toHaveLength(2);
    expect(b.times).toHaveLength(2);
  });

  it("encodes ids that decode back to the array index", () => {
    const events = Array.from({ length: 300 }, (_, i) => ev({ id: `usgs:${i}` }));
    const b = buildHypocenterBuffers(events);
    for (const i of [0, 1, 254, 255, 256, 299]) {
      const r = Math.round(b.ids[i * 3]! * 255);
      const g = Math.round(b.ids[i * 3 + 1]! * 255);
      const bl = Math.round(b.ids[i * 3 + 2]! * 255);
      expect(decodeId(r, g, bl)).toBe(i);
    }
  });

  it("reserves black for 'nothing picked'", () => {
    expect(decodeId(0, 0, 0)).toBeNull();
  });

  it("puts a negative-depth event outside the unit sphere", () => {
    const b = buildHypocenterBuffers([ev({ depthKm: -5 })]);
    expect(Math.hypot(b.positions[0]!, b.positions[1]!, b.positions[2]!)).toBeGreaterThan(1);
  });

  it("puts a 700 km event inside the unit sphere at the right radius", () => {
    const b = buildHypocenterBuffers([ev({ depthKm: 700 })]);
    const r = Math.hypot(b.positions[0]!, b.positions[1]!, b.positions[2]!);
    expect(r).toBeCloseTo(1 - 700 / EARTH_RADIUS_KM, 6);
  });

  it("carries a null depth as 0 in the depth attribute", () => {
    expect(buildHypocenterBuffers([ev({ depthKm: null })]).depths[0]).toBe(0);
  });

  it("keeps second-level time precision through Float32", () => {
    // A millisecond epoch in Float32 is only accurate to hours; seconds-since-2000
    // keeps it to about a second, which is what the reveal animation needs.
    const t = 1_790_136_000_000;
    const b = buildHypocenterBuffers([ev({ time: t })]);
    expect(Math.abs(b.times[0]! - toShaderTime(t))).toBeLessThan(2);
  });

  it("orders the time buffer the same way as the input", () => {
    const b = buildHypocenterBuffers([
      ev({ id: "usgs:a", time: 1_790_000_000_000 }),
      ev({ id: "usgs:b", time: 1_790_136_000_000 }),
    ]);
    expect(b.times[0]!).toBeLessThan(b.times[1]!);
  });

  it("handles an empty list without allocating a zero-length draw", () => {
    const b = buildHypocenterBuffers([]);
    expect(b.count).toBe(0);
    expect(b.positions).toHaveLength(0);
  });

  it("refuses more events than the 24-bit id space allows", () => {
    // Asserted against the constant rather than by allocating 16.7M objects.
    const fake = { length: MAX_PICKABLE_EVENTS + 1 } as unknown as Event[];
    expect(() => buildHypocenterBuffers(fake)).toThrow(/id space/i);
  });
});
