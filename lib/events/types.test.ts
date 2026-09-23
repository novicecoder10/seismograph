import { describe, expect, it } from "vitest";
import { eventKey, isEvent, type Event } from "./types";

const valid: Event = {
  id: "usgs:us7000abcd",
  source: "usgs",
  sourceId: "us7000abcd",
  time: 1_758_600_000_000,
  lat: 35.7,
  lon: -117.6,
  depthKm: 8.2,
  magnitude: 5.4,
  magType: "mww",
  place: "12 km SW of Searles Valley, CA",
  status: "reviewed",
  felt: 312,
  cdi: 5.2,
  mmi: 4.8,
  alert: "green",
  tsunami: false,
  sig: 640,
  url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
};

describe("eventKey", () => {
  it("prefixes the source so ids from two agencies never collide", () => {
    expect(eventKey("usgs", "us7000abcd")).toBe("usgs:us7000abcd");
    expect(eventKey("emsc", "1712345")).toBe("emsc:1712345");
  });

  it("rejects an empty source id rather than producing a bare prefix", () => {
    expect(() => eventKey("usgs", "")).toThrow();
    expect(() => eventKey("usgs", "   ")).toThrow();
  });
});

describe("isEvent", () => {
  it("accepts a well-formed event", () => {
    expect(isEvent(valid)).toBe(true);
  });

  it("accepts a null depth and a negative depth", () => {
    expect(isEvent({ ...valid, depthKm: null })).toBe(true);
    expect(isEvent({ ...valid, depthKm: -2.1 })).toBe(true);
  });

  it("rejects a missing or non-finite magnitude", () => {
    expect(isEvent({ ...valid, magnitude: null })).toBe(false);
    expect(isEvent({ ...valid, magnitude: NaN })).toBe(false);
  });

  it("rejects a non-finite or non-numeric time", () => {
    expect(isEvent({ ...valid, time: NaN })).toBe(false);
    expect(isEvent({ ...valid, time: "2026-09-23" })).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    expect(isEvent({ ...valid, lat: 91 })).toBe(false);
    expect(isEvent({ ...valid, lat: -91 })).toBe(false);
    expect(isEvent({ ...valid, lon: 181 })).toBe(false);
    expect(isEvent({ ...valid, lon: -181 })).toBe(false);
  });

  it("accepts the coordinate extremes", () => {
    for (const lat of [-90, 90]) expect(isEvent({ ...valid, lat })).toBe(true);
    for (const lon of [-180, 180]) expect(isEvent({ ...valid, lon })).toBe(true);
  });

  it("rejects non-objects", () => {
    for (const v of [null, undefined, 42, "x", []]) expect(isEvent(v)).toBe(false);
  });
});
