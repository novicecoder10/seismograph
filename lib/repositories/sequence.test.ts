import { describe, expect, it } from "vitest";
import type { Event, EventFilter } from "../events/types";
import type { EventRepository } from "./events";
import { loadSequence } from "./sequence";

const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function ev(id: string, time: number, magnitude: number, lat = 35, lon = -117): Event {
  return {
    id, source: "usgs", sourceId: id, time, lat, lon, depthKm: 8, magnitude, magType: "ml",
    place: "", status: "reviewed", felt: null, cdi: null, mmi: null, alert: null,
    tsunami: false, sig: null, url: null,
  };
}

function fakeRepo(events: Event[], opts: { failQuery?: boolean; cursor?: string | null } = {}) {
  const calls: { filter: EventFilter; limit?: number }[] = [];
  const repo: EventRepository = {
    name: "fake",
    async byId(id) {
      return events.find((e) => e.id === id) ?? null;
    },
    async query(filter, o) {
      calls.push({ filter, limit: o?.limit });
      if (opts.failQuery) throw new Error("HTTP 503");
      return { events: events.filter((e) => e.time >= filter.range.startMs && e.time <= filter.range.endMs), cursor: opts.cursor ?? null, total: null };
    },
  };
  return { repo, calls };
}

const main = ev("usgs:main", T0, 6.4);
const after = Array.from({ length: 30 }, (_, i) => ev(`usgs:a${i}`, T0 + (i + 1) * 0.1 * DAY, 3 + (i % 5) * 0.3, 35.01, -117.02));

describe("loadSequence", () => {
  it("queries the rupture-scaled window and analyses the result", async () => {
    const { repo, calls } = fakeRepo([main, ...after]);
    const r = await loadSequence("usgs:main", { fdsn: repo, now: () => T0 + 40 * DAY });
    if ("error" in r) throw new Error(r.error);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.limit).toBe(20_000);
    expect(calls[0]!.filter.minMagnitude).toBeCloseTo(2.4, 5);
    expect(calls[0]!.filter.bbox).not.toBeNull();
    expect(r.analysis.mainshock.id).toBe("usgs:main");
    expect(r.analysis.events.length).toBe(31);
    expect(r.truncated).toBe(false);
  });

  it("flags a catalogue that hit the row limit", async () => {
    const { repo } = fakeRepo([main, ...after], { cursor: "20000" });
    const r = await loadSequence("usgs:main", { fdsn: repo, now: () => T0 + 40 * DAY });
    expect("truncated" in r && r.truncated).toBe(true);
  });

  it("says so when the mainshock does not exist", async () => {
    const { repo } = fakeRepo([main]);
    const r = await loadSequence("usgs:nope", { fdsn: repo });
    expect(r).toEqual({ error: expect.stringContaining("usgs:nope") });
  });

  it("turns a failed catalogue fetch into a sentence", async () => {
    const { repo } = fakeRepo([main], { failQuery: true });
    const r = await loadSequence("usgs:main", { fdsn: repo, now: () => T0 + DAY });
    expect("error" in r && r.error).toMatch(/HTTP 503/);
  });
});
