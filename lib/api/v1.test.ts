import { describe, expect, it } from "vitest";
import { forecastBody, parseEventQuery } from "./v1";

const NOW = Date.UTC(2026, 8, 25, 12);
const q = (s: string) => parseEventQuery(new URLSearchParams(s), NOW);

describe("parseEventQuery", () => {
  it("defaults to the last seven days at M4.5+, JSON, 1000 events", () => {
    const r = q("");
    if ("error" in r) throw new Error(r.error);
    expect(r.filter.range).toEqual({ startMs: NOW - 7 * 86_400_000, endMs: NOW });
    expect(r.filter.minMagnitude).toBe(4.5);
    expect(r.filter.bbox).toBeNull();
    expect(r).toMatchObject({ limit: 1000, offset: 0, format: "json" });
  });

  it("reads FDSN parameter names, ISO dates as UTC, and a bounding box", () => {
    const r = q("starttime=2019-07-04&endtime=2019-07-10T00:00:00&minmagnitude=5&maxdepth=30&minlatitude=34&maxlatitude=37&minlongitude=-119&maxlongitude=-116&format=CSV&limit=50");
    if ("error" in r) throw new Error(r.error);
    expect(r.filter.range).toEqual({ startMs: Date.UTC(2019, 6, 4), endMs: Date.UTC(2019, 6, 10) });
    expect(r.filter.minMagnitude).toBe(5);
    expect(r.filter.maxDepthKm).toBe(30);
    expect(r.filter.bbox).toEqual({ south: 34, north: 37, west: -119, east: -116 });
    expect(r).toMatchObject({ format: "csv", limit: 50 });
  });

  it("never serves below the M4.5 floor", () => {
    const r = q("minmagnitude=2");
    expect("error" in r ? null : r.filter.minMagnitude).toBe(4.5);
  });

  it.each([
    ["starttime=yesterday", /starttime/],
    ["limit=0", /limit/],
    ["limit=50000", /limit/],
    ["format=xlsx", /format/],
    ["minlatitude=10", /bounding box/],
    ["minlatitude=10&maxlatitude=5&minlongitude=0&maxlongitude=1", /below/],
    ["starttime=2026-09-20&endtime=2026-09-19", /before/],
    ["minmagnitude=abc", /minmagnitude/],
  ])("rejects %s with a sentence", (s, re) => {
    const r = q(s);
    expect("error" in r && r.error).toMatch(re);
  });
});

describe("forecastBody", () => {
  it("drops the posterior grid's typed arrays", () => {
    const body = forecastBody({
      kind: "computed",
      event: { id: "x" } as never,
      forecast: {} as never,
      baseline: {} as never,
      regime: { code: "ANSR-SHALCON", strec: "", description: "" } as never,
      searchRadiusKm: 50,
      centroid: { lat: 0, lon: 0 },
      truncated: false,
      posterior: { grid: {} as never, weights: new Float64Array(10), b: 1, magMain: 7, mean: { a: -2, p: 1, c: 0.018 }, sd: { a: 0.1, p: 0, c: 0 }, n: 40, edgeMass: 0 },
    });
    expect(JSON.stringify(body)).not.toContain("weights");
    expect(body).toMatchObject({ posterior: { n: 40, b: 1 } });
  });
});
