import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isEvent } from "../types";
import { normalizeUsgsGeoJson } from "./usgs";

const fixture = (name: string) =>
  JSON.parse(readFileSync(`test/fixtures/${name}.json`, "utf8"));

describe("normalizeUsgsGeoJson", () => {
  it("normalises the live M4.5+ FDSN week", () => {
    const r = normalizeUsgsGeoJson(fixture("usgs-fdsn-m45-week"));
    console.log(`fdsn week: accepted ${r.accepted.length}, rejected ${r.rejected.length}`);
    expect(r.accepted.length).toBeGreaterThan(20);
    expect(r.accepted.every(isEvent)).toBe(true);
    for (const e of r.accepted) {
      expect(e.source).toBe("usgs");
      expect(e.id.startsWith("usgs:")).toBe(true);
      expect(e.magnitude).toBeGreaterThanOrEqual(4.4);
    }
  });

  it("normalises the live all_hour feed at every magnitude", () => {
    const r = normalizeUsgsGeoJson(fixture("usgs-all-hour"));
    console.log(`all_hour: accepted ${r.accepted.length}, rejected ${r.rejected.length}`);
    expect(r.accepted.every(isEvent)).toBe(true);
  });

  it("carries the impact fields through", () => {
    const r = normalizeUsgsGeoJson(fixture("usgs-significant-month"));
    const withFelt = r.accepted.filter((e) => e.felt !== null);
    expect(withFelt.length).toBeGreaterThan(0);
    for (const e of withFelt) expect(e.felt).toBeGreaterThan(0);
  });

  it("reports null-magnitude events as rejected with a reason, never silently", () => {
    const r = normalizeUsgsGeoJson({
      type: "FeatureCollection",
      features: [
        {
          id: "nomag",
          geometry: { type: "Point", coordinates: [-117.6, 35.7, 8.2] },
          properties: { mag: null, time: 1758600000000, place: "somewhere" },
        },
      ],
    });
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/magnitude/i);
  });

  it("preserves a negative depth rather than clamping it", () => {
    const r = normalizeUsgsGeoJson({
      type: "FeatureCollection",
      features: [
        {
          id: "above-sea",
          geometry: { type: "Point", coordinates: [-117.6, 35.7, -1.8] },
          properties: { mag: 4.7, time: 1758600000000, place: "high place" },
        },
      ],
    });
    expect(r.accepted[0]!.depthKm).toBeCloseTo(-1.8, 5);
  });

  it("accepts a null depth", () => {
    const r = normalizeUsgsGeoJson({
      type: "FeatureCollection",
      features: [
        {
          id: "nodepth",
          geometry: { type: "Point", coordinates: [-117.6, 35.7, null] },
          properties: { mag: 4.7, time: 1758600000000, place: "p" },
        },
      ],
    });
    expect(r.accepted[0]!.depthKm).toBeNull();
  });

  it("rejects a feature with no geometry and no coordinates", () => {
    const r = normalizeUsgsGeoJson({
      type: "FeatureCollection",
      features: [{ id: "nogeom", properties: { mag: 4.7, time: 1758600000000 } }],
    });
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.reason).toMatch(/coordinate|geometry/i);
  });

  it("returns an empty report for junk input rather than throwing", () => {
    for (const junk of [null, undefined, 42, "x", {}, { features: null }]) {
      expect(normalizeUsgsGeoJson(junk).accepted).toHaveLength(0);
    }
  });
});
