import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventFilter } from "../events/types";
import { chooseFeed, createUsgsFeedRepository } from "./usgs-feed";

const hourFixture = readFileSync("test/fixtures/usgs-all-hour.json", "utf8");

// The range must sit inside a feed window, or chooseFeed returns null and every
// assertion below passes vacuously on an empty page.
const filter = (over: Partial<EventFilter> = {}): EventFilter => ({
  range: { startMs: Date.now() - 1_800_000, endMs: Date.now() + 60_000 },
  minMagnitude: 0,
  maxMagnitude: null,
  minDepthKm: null,
  maxDepthKm: null,
  bbox: null,
  ...over,
});

describe("chooseFeed", () => {
  const now = Date.UTC(2026, 8, 23, 12, 0, 0);
  it("picks the smallest feed that covers the range", () => {
    expect(chooseFeed({ startMs: now - 1_000, endMs: now }, now)).toBe("hour");
    expect(chooseFeed({ startMs: now - 7_200_000, endMs: now }, now)).toBe("day");
    expect(chooseFeed({ startMs: now - 200_000_000, endMs: now }, now)).toBe("week");
    expect(chooseFeed({ startMs: now - 1_000_000_000, endMs: now }, now)).toBe("month");
  });
  it("returns null for a range older than every feed", () => {
    expect(chooseFeed({ startMs: now - 10_000_000_000, endMs: now }, now)).toBeNull();
  });
});

describe("createUsgsFeedRepository", () => {
  const repo = (body = hourFixture) =>
    createUsgsFeedRepository({
      fetchImpl: async () => new Response(body, { status: 200 }),
    });

  it("returns the fixture's events for a range inside the feed window", async () => {
    // Guards every assertion below: an empty page would satisfy all of them.
    const page = await repo().query(filter(), { limit: 500 });
    expect(page.events.length).toBeGreaterThan(0);
  });

  it("applies the magnitude floor client-side", async () => {
    const all = await repo().query(filter(), { limit: 500 });
    const page = await repo().query(filter({ minMagnitude: 2.5 }), { limit: 500 });
    expect(page.events.length).toBeLessThan(all.events.length);
    for (const e of page.events) expect(e.magnitude).toBeGreaterThanOrEqual(2.5);
  });

  it("reports the pre-limit total so the UI can say how many matched", async () => {
    const page = await repo().query(filter(), { limit: 1 });
    expect(page.events.length).toBeLessThanOrEqual(1);
    expect(page.total).toBeGreaterThanOrEqual(page.events.length);
  });

  it("returns events in descending time order", async () => {
    const times = (await repo().query(filter(), { limit: 100 })).events.map((e) => e.time);
    expect(times.length).toBeGreaterThan(1);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("returns empty for a range no feed covers, rather than the wrong window", async () => {
    const page = await repo().query(
      filter({ range: { startMs: Date.UTC(1990, 0, 1), endMs: Date.UTC(1990, 0, 2) } }),
      { limit: 10 },
    );
    expect(page.events).toHaveLength(0);
  });

  it("excludes events with a null depth when a depth filter is set", async () => {
    const body = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          id: "nd",
          geometry: { type: "Point", coordinates: [0, 0, null] },
          properties: { mag: 5, time: Date.now(), place: "p" },
        },
      ],
    });
    const page = await repo(body).query(
      filter({ minDepthKm: 0, maxDepthKm: 700 }),
      { limit: 10 },
    );
    expect(page.events).toHaveLength(0);
  });

  it("includes that same event when no depth filter is set", async () => {
    const body = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          id: "nd",
          geometry: { type: "Point", coordinates: [0, 0, null] },
          properties: { mag: 5, time: Date.now(), place: "p" },
        },
      ],
    });
    expect((await repo(body).query(filter(), { limit: 10 })).events).toHaveLength(1);
  });

  it("throws on a feed error so the caller can degrade honestly", async () => {
    const broken = createUsgsFeedRepository({
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    await expect(broken.query(filter(), { limit: 10 })).rejects.toThrow(/503/);
  });

  it("returns null from byId for a non-usgs id without fetching", async () => {
    let fetched = false;
    const r = createUsgsFeedRepository({
      fetchImpl: async () => {
        fetched = true;
        return new Response(hourFixture, { status: 200 });
      },
    });
    expect(await r.byId("emsc:123")).toBeNull();
    expect(fetched).toBe(false);
  });
});
