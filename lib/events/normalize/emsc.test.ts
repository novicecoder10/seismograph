import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isEvent } from "../types";
import { normalizeEmscGeoJson } from "./emsc";

const shapes = JSON.parse(readFileSync("test/fixtures/emsc-shapes.json", "utf8")) as {
  features: { id: string }[];
};

const byId = (id: string) =>
  normalizeEmscGeoJson({
    type: "FeatureCollection",
    features: shapes.features.filter((f) => f.id === id),
  });

const EXPECTED_MS = Date.UTC(2026, 8, 23, 4, 0, 0); // 2026-09-23T04:00:00Z

describe("normalizeEmscGeoJson — the four time encodings", () => {
  it("reads a seconds epoch and scales it to milliseconds", () => {
    expect(byId("seconds-epoch").accepted[0]!.time).toBe(EXPECTED_MS);
  });

  it("reads a milliseconds epoch unchanged", () => {
    expect(byId("millis-epoch").accepted[0]!.time).toBe(EXPECTED_MS);
  });

  it("reads an ISO 8601 string", () => {
    expect(byId("iso-string").accepted[0]!.time).toBe(EXPECTED_MS);
  });

  it("reads a nested { time: { time } } object — the live API 1.6 shape", () => {
    expect(byId("nested-time-object").accepted[0]!.time).toBe(EXPECTED_MS);
  });

  it("keeps the millisecond part of a fractional seconds epoch", () => {
    expect(byId("fractional-seconds").accepted[0]!.time).toBe(EXPECTED_MS + 430);
  });

  it("falls back to lastupdate when no time field is present", () => {
    expect(byId("lastupdate-fallback").accepted[0]!.time).toBe(EXPECTED_MS);
  });

  it("rejects an event with no usable time at all", () => {
    const r = byId("no-time-at-all");
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.reason).toMatch(/time/i);
  });
});

describe("normalizeEmscGeoJson — the three magnitude shapes", () => {
  it("reads a bare numeric mag", () => {
    expect(byId("seconds-epoch").accepted[0]!.magnitude).toBeCloseTo(4.8, 5);
  });

  it("reads a { mag, mag_type } object and keeps the type", () => {
    const e = byId("magnitude-object").accepted[0]!;
    expect(e.magnitude).toBeCloseTo(5.1, 5);
    expect(e.magType).toBe("mb");
  });

  it("also accepts the legacy magtype spelling", () => {
    expect(byId("magnitude-object-legacy-magtype").accepted[0]!.magType).toBe("ML");
  });

  it("rejects an event with no magnitude", () => {
    const r = byId("no-magnitude");
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.reason).toMatch(/magnitude/i);
  });
});

describe("normalizeEmscGeoJson — location, place and tsunami shapes", () => {
  it("falls back to a location object when geometry is absent", () => {
    const e = byId("location-object-no-geometry").accepted[0]!;
    expect(e.lat).toBeCloseTo(41.9, 5);
    expect(e.lon).toBeCloseTo(12.5, 5);
    expect(e.depthKm).toBeCloseTo(33.0, 5);
  });

  it("reads a place object's region", () => {
    expect(byId("place-object").accepted[0]!.place).toBe("SLOVENIA");
  });

  it("treats a tsunami type of NONE as no tsunami", () => {
    expect(byId("tsunami-object-none").accepted[0]!.tsunami).toBe(false);
  });

  it("treats a real tsunami type as a tsunami", () => {
    expect(byId("tsunami-object-real").accepted[0]!.tsunami).toBe(true);
  });
});

describe("normalizeEmscGeoJson — the live payload", () => {
  it("normalises the captured live feed", () => {
    const live = JSON.parse(readFileSync("test/fixtures/emsc-recent.json", "utf8"));
    const r = normalizeEmscGeoJson(live);
    console.log(`emsc live: accepted ${r.accepted.length}, rejected ${r.rejected.length}`);
    expect(r.accepted.length).toBeGreaterThan(0);
    expect(r.accepted.every(isEvent)).toBe(true);
    for (const e of r.accepted) {
      expect(e.id.startsWith("emsc:")).toBe(true);
      expect(e.place).not.toBe("Unknown location");
      expect(Number.isFinite(e.time)).toBe(true);
    }
  });

  it("produces valid events across every pinned shape", () => {
    const r = normalizeEmscGeoJson(shapes);
    expect(r.accepted.length).toBeGreaterThan(0);
    expect(r.accepted.every(isEvent)).toBe(true);
    expect(r.accepted.every((e) => e.id.startsWith("emsc:"))).toBe(true);
  });

  it("returns an empty report for junk rather than throwing", () => {
    for (const junk of [null, 0, "", { features: "no" }]) {
      expect(normalizeEmscGeoJson(junk).accepted).toHaveLength(0);
    }
  });
});
