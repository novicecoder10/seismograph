import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  decodeViewState,
  defaultViewState,
  encodeViewState,
  type ViewState,
} from "./url";

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

const sample: ViewState = {
  filter: {
    range: { startMs: Date.UTC(2026, 8, 16), endMs: Date.UTC(2026, 8, 23) },
    minMagnitude: 4.5,
    maxMagnitude: 7.5,
    minDepthKm: 0,
    maxDepthKm: 700,
    bbox: { west: 170, east: -170, south: -20, north: 20 },
  },
  t: Date.UTC(2026, 8, 20),
  rate: 3600,
  view: "globe",
  camera: { lon: -117.6, lat: 35.7, altitude: 2.4 },
  selectedId: "usgs:us7000abcd",
};

describe("view state round-trip", () => {
  it("restores an explicit state exactly", () => {
    const back = decodeViewState(encodeViewState(sample), NOW);
    expect(back.filter.minMagnitude).toBeCloseTo(4.5, 6);
    expect(back.filter.maxMagnitude).toBeCloseTo(7.5, 6);
    expect(back.filter.range).toEqual(sample.filter.range);
    expect(back.filter.bbox).toEqual(sample.filter.bbox);
    expect(back.filter.minDepthKm).toBe(0);
    expect(back.filter.maxDepthKm).toBe(700);
    expect(back.t).toBe(sample.t);
    expect(back.rate).toBe(sample.rate);
    expect(back.view).toBe("globe");
    expect(back.camera!.lon).toBeCloseTo(-117.6, 4);
    expect(back.camera!.lat).toBeCloseTo(35.7, 4);
    expect(back.camera!.altitude).toBeCloseTo(2.4, 4);
    expect(back.selectedId).toBe("usgs:us7000abcd");
  });

  it("carries a turned, tipped close view, and old three-part links still open", () => {
    const close = { ...sample, camera: { lon: 139.69, lat: 35.68, altitude: 1.0008, heading: 42, tilt: 55 } };
    const back = decodeViewState(encodeViewState(close), NOW).camera!;
    expect(back.altitude).toBeCloseTo(1.0008, 6);
    expect(back).toMatchObject({ heading: 42, tilt: 55 });
    const old = decodeViewState("cam=-117.6,35.7,2.4", NOW).camera!;
    expect(old).toMatchObject({ lon: -117.6, lat: 35.7, altitude: 2.4, heading: 0, tilt: 0 });
  });

  it("round-trips for arbitrary valid states", () => {
    fc.assert(
      fc.property(
        fc.record({
          minMagnitude: fc.integer({ min: 0, max: 90 }),
          days: fc.integer({ min: 1, max: 3650 }),
          view: fc.constantFrom("globe" as const, "map" as const, "table" as const),
          rate: fc.constantFrom(1, 60, 3600, 86_400),
        }),
        ({ minMagnitude, days, view, rate }) => {
          const range = { startMs: NOW - days * 86_400_000, endMs: NOW };
          const state: ViewState = {
            ...defaultViewState(NOW),
            filter: { ...defaultViewState(NOW).filter, minMagnitude: minMagnitude / 10, range },
            t: range.endMs,
            rate,
            view,
          };
          const back = decodeViewState(encodeViewState(state), NOW);
          return (
            Math.abs(back.filter.minMagnitude - state.filter.minMagnitude) < 1e-9 &&
            back.filter.range.startMs === range.startMs &&
            back.filter.range.endMs === range.endMs &&
            back.view === view &&
            back.rate === rate &&
            back.t === state.t
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("omits defaults so a shared link stays short", () => {
    const qs = encodeViewState(defaultViewState(NOW));
    // Only from and to survive; everything else is at its default.
    expect(qs.split("&").sort()).toEqual([`from=${NOW - 7 * 86_400_000}`, `to=${NOW}`]);
  });
});

describe("decodeViewState is total", () => {
  const hostile = [
    "",
    "?",
    "t=NaN",
    "t=1e30",
    "t=-1e30",
    "rate=-5",
    "rate=NaN",
    "rate=Infinity",
    "view=../../etc/passwd",
    "view=<script>alert(1)</script>",
    "minmag=abc",
    "minmag=-99",
    "minmag=1e400",
    "maxmag=1&minmag=8",
    "mindepth=900&maxdepth=10",
    "bbox=1,2,3",
    "bbox=a,b,c,d",
    "bbox=999,999,999,999",
    "bbox=10,50,20,10",
    "cam=1",
    "cam=0,0,-999",
    "sel=" + "x".repeat(10_000),
    "sel=<img src=x>",
    "from=9999999999999999&to=-1",
    "from=2&to=1",
    "%E0%A4%A",
  ];

  for (const qs of hostile) {
    it(`survives ${JSON.stringify(qs.slice(0, 40))}`, () => {
      const v = decodeViewState(qs, NOW);
      expect(Number.isFinite(v.t)).toBe(true);
      expect(Number.isFinite(v.rate)).toBe(true);
      expect(v.rate).toBeGreaterThan(0);
      expect(["globe", "map", "table"]).toContain(v.view);
      expect(Number.isFinite(v.filter.minMagnitude)).toBe(true);
      expect(v.filter.range.endMs).toBeGreaterThan(v.filter.range.startMs);
      expect(v.t).toBeGreaterThanOrEqual(v.filter.range.startMs);
      expect(v.t).toBeLessThanOrEqual(v.filter.range.endMs);
      if (v.filter.maxMagnitude !== null) {
        expect(v.filter.maxMagnitude).toBeGreaterThanOrEqual(v.filter.minMagnitude);
      }
      if (v.filter.maxDepthKm !== null && v.filter.minDepthKm !== null) {
        expect(v.filter.maxDepthKm).toBeGreaterThanOrEqual(v.filter.minDepthKm);
      }
      if (v.filter.bbox) {
        expect(Math.abs(v.filter.bbox.north)).toBeLessThanOrEqual(90);
        expect(Math.abs(v.filter.bbox.south)).toBeLessThanOrEqual(90);
        expect(v.filter.bbox.north).toBeGreaterThan(v.filter.bbox.south);
      }
      if (v.camera) expect(v.camera.altitude).toBeGreaterThan(1);
      if (v.selectedId !== null) expect(v.selectedId.length).toBeLessThanOrEqual(128);
    });
  }

  it("keeps t inside the decoded range", () => {
    const v = decodeViewState("from=1790000000000&to=1790136000000&t=99999999999999", NOW);
    expect(v.t).toBe(1790136000000);
  });

  it("never returns a script-bearing view or selection", () => {
    const v = decodeViewState("view=<script>&sel=<script>", NOW);
    expect(v.view).toBe("globe");
    expect(v.selectedId).toBeNull();
  });
});
