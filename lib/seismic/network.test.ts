// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Trace } from "./miniseed";
import { assembleThreeComponent, azimuthDeg, distanceDeg, isThreeComponent, parseChannelText, selectRecordSection, type SectionStation } from "./network";

const RIDGECREST = { lat: 35.7695, lon: -117.5993, time: Date.UTC(2019, 6, 6, 3, 19, 53) };
const gsn = parseChannelText(readFileSync("test/fixtures/stations/gsn-2019-07-06.txt", "utf8"), "gsn", RIDGECREST.time);
const shakes = parseChannelText(readFileSync("test/fixtures/stations/rshake-ridgecrest.txt", "utf8"), "rshake", Date.UTC(2026, 8, 25));

describe("station metadata", () => {
  it("groups channels into stations with one location code each", () => {
    expect(gsn.length).toBeGreaterThan(100);
    const keys = gsn.map((s) => `${s.network}.${s.station}`);
    expect(new Set(keys).size).toBe(keys.length);
    const anmo = gsn.find((s) => s.station === "ANMO")!;
    expect(anmo.location).toBe("00");
    expect(isThreeComponent(anmo)).toBe(true);
  });

  it("drops channels closed at the event time", () => {
    const later = parseChannelText(readFileSync("test/fixtures/stations/gsn-2019-07-06.txt", "utf8"), "gsn", Date.UTC(1990, 0, 1));
    expect(later.length).toBeLessThan(gsn.length);
  });
});

describe("geometry", () => {
  it("azimuth and distance agree with known values", () => {
    expect(azimuthDeg(0, 0, 10, 0)).toBeCloseTo(0, 6);
    expect(azimuthDeg(0, 0, 0, 10)).toBeCloseTo(90, 6);
    expect(azimuthDeg(0, 0, -10, 0)).toBeCloseTo(180, 6);
    expect(distanceDeg(0, 0, 0, 90)).toBeCloseTo(90, 6);
    expect(distanceDeg(0, 0, 0, 180)).toBeCloseTo(180, 6);
  });
});

describe("record-section selection", () => {
  const section = selectRecordSection(RIDGECREST, [...gsn, ...shakes]);

  it("spreads stations across distance, nearest shakes first", () => {
    expect(section[0]!.source).toBe("rshake");
    const gsnDists = section.filter((s) => s.source === "gsn").map((s) => Math.floor(s.distanceDeg / 10));
    expect(new Set(gsnDists).size).toBe(gsnDists.length); // one per band
    expect(gsnDists.length).toBeGreaterThan(12);
    expect(section.map((s) => s.distanceDeg)).toEqual([...section.map((s) => s.distanceDeg)].sort((a, b) => a - b));
  });

  it("prefers three-component stations", () => {
    for (const s of section.filter((x) => x.source === "gsn")) expect(isThreeComponent(s)).toBe(true);
  });
});

describe("three-component assembly", () => {
  const station: SectionStation = {
    network: "IU", station: "XX", location: "00", lat: 0, lon: 0, source: "gsn", distanceDeg: 50, azimuthDeg: 10,
    channels: [{ code: "BHZ", azimuth: 0, dip: -90, sampleRate: 20 }, { code: "BH1", azimuth: 0, dip: 0, sampleRate: 20 }, { code: "BH2", azimuth: 90, dip: 0, sampleRate: 20 }],
  };
  const tr = (channel: string, startMs: number, values: number[]): Trace => ({ network: "IU", station: "XX", location: "00", channel, startTime: new Date(startMs), sampleRate: 20, samples: Float32Array.from(values) });

  it("aligns on a common start and rotates horizontals", () => {
    const t0 = 1_000_000;
    const c = assembleThreeComponent(station, [tr("BHZ", t0, [1, 2, 3, 4]), tr("BH1", t0 + 50, [5, 6, 7]), tr("BH2", t0, [8, 9, 10, 11])])!;
    expect(c.startMs).toBe(t0 + 50);
    expect(Array.from(c.z)).toEqual([2, 3, 4]);
    expect(Array.from(c.north!)).toEqual([5, 6, 7]);
    expect(Array.from(c.east!).map(Math.round)).toEqual([9, 10, 11]);
  });

  it("returns vertical only when horizontals are missing, and null without a vertical", () => {
    expect(assembleThreeComponent(station, [tr("BHZ", 0, [1, 2])])!.north).toBeNull();
    expect(assembleThreeComponent(station, [tr("BH1", 0, [1, 2])])).toBeNull();
  });
});
