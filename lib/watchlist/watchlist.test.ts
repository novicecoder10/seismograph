import { describe, expect, it } from "vitest";
import type { Event } from "../events/types";
import { addPlace, digest, digestWindow, EMPTY, MAX_PLACES, parseState, poissonQuantile, removePlace, usualSentence, validatePlace, type Place } from "./watchlist";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 25);
const tokyo: Place = { id: "t", name: "Tokyo", lat: 35.68, lon: 139.69, radiusKm: 300, minMagnitude: 4.5 };
const ev = (id: string, daysAgo: number, mag = 4.8, lat = 35.9, lon = 140.1): Event =>
  ({ id, time: NOW - daysAgo * DAY, lat, lon, depthKm: 40, magnitude: mag, magType: "mb", place: "near Tokyo", status: "reviewed", source: "usgs", url: "" }) as unknown as Event;

describe("storage", () => {
  it("survives garbage and drops invalid places", () => {
    expect(parseState(null)).toEqual(EMPTY);
    expect(parseState("{not json")).toEqual(EMPTY);
    const s = parseState(JSON.stringify({ places: [tokyo, { ...tokyo, id: "bad", lat: 200 }, "x"], lastVisit: "yesterday" }));
    expect(s.places).toEqual([tokyo]);
    expect(s.lastVisit).toBeNull();
  });

  it("adds, caps and removes", () => {
    let s = addPlace(EMPTY, { name: "  Lima ", lat: -12, lon: -77, radiusKm: 200, minMagnitude: 5 }, "l");
    expect(s.places[0]!.name).toBe("Lima");
    for (let i = 0; i < 30; i++) s = addPlace(s, tokyo, `t${i}`);
    expect(s.places).toHaveLength(MAX_PLACES);
    expect(removePlace(s, "l").places.some((p) => p.id === "l")).toBe(false);
  });

  it("validates with sentences", () => {
    expect(validatePlace({ name: "x", lat: 0, lon: 0, radiusKm: 100, minMagnitude: 4.5 })).toBeNull();
    expect(validatePlace({ name: "", lat: 0, lon: 0, radiusKm: 100, minMagnitude: 4.5 })).toMatch(/name/);
    expect(validatePlace({ name: "x", lat: NaN, lon: 0, radiusKm: 100, minMagnitude: 4.5 })).toMatch(/Latitude/);
    expect(validatePlace({ name: "x", lat: 0, lon: 0, radiusKm: 100, minMagnitude: 3 })).toMatch(/4\.5/);
  });
});

describe("poissonQuantile", () => {
  it("matches tabulated values", () => {
    expect(poissonQuantile(0, 0.975)).toBe(0);
    expect(poissonQuantile(1, 0.025)).toBe(0);
    expect(poissonQuantile(1, 0.975)).toBe(3);
    expect(poissonQuantile(10, 0.025)).toBe(4);
    expect(poissonQuantile(10, 0.975)).toBe(17);
  });
  it("falls back to the normal approximation for huge means", () => {
    expect(poissonQuantile(1e4, 0.975)).toBeCloseTo(1e4 + 196, -1);
  });
});

describe("digest", () => {
  it("covers the past week on a first visit", () => {
    expect(digestWindow(null, NOW).sinceMs).toBe(NOW - 7 * DAY);
  });

  it("splits events into since-last-visit and the reference year, inside the circle only", () => {
    const reference = Array.from({ length: 73 }, (_, i) => ev(`r${i}`, 10 + i * 5)); // 73 in the year before → 0.2/day
    const events = [...reference, ev("a", 1, 5.2), ev("b", 2), ev("far", 1, 6, -30, 20), ev("small", 1, 4.5 - 0.1)];
    const d = digest(tokyo, events, NOW - 5 * DAY, NOW);
    expect(d.since.map((e) => e.id)).toEqual(["a", "b"]);
    expect(d.largest?.id).toBe("a");
    expect(d.expected).toBeCloseTo(73 / 365 * 5, 6);
    expect(d.usual).toBe("usual");
    expect(usualSentence(d)).toMatch(/usually records/);
  });

  it("says 'more' only outside the 95% range, and never uses alarm words", () => {
    const events = [ev("r", 100), ...Array.from({ length: 12 }, (_, i) => ev(`s${i}`, 1))];
    const d = digest(tokyo, events, NOW - 3 * DAY, NOW);
    expect(d.usual).toBe("more");
    expect(usualSentence(d)).not.toMatch(/danger|warning|alert|risk|safe/i);
  });

  it("has no reference when the area is quiet", () => {
    expect(digest(tokyo, [], NOW - DAY, NOW).usual).toBe("no-reference");
  });
});
