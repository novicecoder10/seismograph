import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventFilter } from "../events/types";
import { describeEventRepository } from "./events";
import { createUsgsFdsnRepository } from "./usgs-fdsn";

interface RawFeature {
  id: string;
  properties: { mag: number; time: number };
  geometry: { coordinates: number[] };
}

const all = JSON.parse(
  readFileSync("test/fixtures/usgs-fdsn-m45-week.json", "utf8"),
) as { features: RawFeature[] };

/** Replays the committed fixture, applying whichever query parameters the
 *  repository actually sent, so the contract runs against real payload shapes
 *  with no network. */
const recordedFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));

  const eventId = url.searchParams.get("eventid");
  if (eventId !== null) {
    const hit = all.features.find((f) => f.id === eventId);
    if (!hit) return new Response(null, { status: 404 });
    return Response.json(hit);
  }

  const minMag = Number(url.searchParams.get("minmagnitude") ?? "0");
  const maxMag = url.searchParams.get("maxmagnitude");
  const start = Date.parse(`${url.searchParams.get("starttime")}Z`);
  const end = Date.parse(`${url.searchParams.get("endtime")}Z`);
  const minLat = url.searchParams.get("minlatitude");
  const maxLat = url.searchParams.get("maxlatitude");
  const minLon = url.searchParams.get("minlongitude");
  const maxLon = url.searchParams.get("maxlongitude");
  const limit = Number(url.searchParams.get("limit") ?? "500");

  const features = all.features.filter((f) => {
    const p = f.properties;
    const lon = f.geometry.coordinates[0] as number;
    const lat = f.geometry.coordinates[1] as number;
    if (p.mag < minMag) return false;
    if (maxMag !== null && p.mag > Number(maxMag)) return false;
    if (p.time < start || p.time > end) return false;
    if (minLat !== null && lat < Number(minLat)) return false;
    if (maxLat !== null && lat > Number(maxLat)) return false;
    if (minLon !== null && lon < Number(minLon)) return false;
    if (maxLon !== null && lon > Number(maxLon)) return false;
    return true;
  });

  if (features.length === 0) return new Response(null, { status: 204 });
  return Response.json({ type: "FeatureCollection", features: features.slice(0, limit) });
};

describeEventRepository("usgs-fdsn (recorded)", () =>
  createUsgsFdsnRepository({ fetchImpl: recordedFetch }),
);

const filter = (over: Partial<EventFilter> = {}): EventFilter => ({
  range: { startMs: Date.UTC(2026, 8, 15), endMs: Date.UTC(2026, 8, 22) },
  minMagnitude: 4.5,
  maxMagnitude: null,
  minDepthKm: null,
  maxDepthKm: null,
  bbox: null,
  ...over,
});

describe("createUsgsFdsnRepository url construction", () => {
  it("sends a 1-based offset, ISO times without milliseconds, and orderby=time", async () => {
    let seen = "";
    const repo = createUsgsFdsnRepository({
      fetchImpl: async (input) => {
        seen = String(input);
        return new Response(null, { status: 204 });
      },
    });
    await repo.query(filter(), { limit: 10 });
    expect(seen).toContain("starttime=2026-09-15T00%3A00%3A00");
    expect(seen).not.toContain(".000");
    expect(seen).toContain("offset=1");
    expect(seen).toContain("orderby=time");
  });

  it("issues two requests for an antimeridian-crossing bbox", async () => {
    const urls: string[] = [];
    const repo = createUsgsFdsnRepository({
      fetchImpl: async (input) => {
        urls.push(String(input));
        return new Response(null, { status: 204 });
      },
    });
    await repo.query(
      filter({ bbox: { west: 170, east: -170, south: -10, north: 10 } }),
      { limit: 10 },
    );
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("minlongitude=170");
    expect(urls[1]).toContain("minlongitude=-180");
  });

  it("treats 204 and 404 as no data, not as errors", async () => {
    for (const status of [204, 404]) {
      const repo = createUsgsFdsnRepository({
        fetchImpl: async () => new Response(null, { status }),
      });
      expect((await repo.query(filter(), { limit: 10 })).events).toHaveLength(0);
    }
  });

  it("throws on a 500 so the caller can show the degradation banner", async () => {
    const repo = createUsgsFdsnRepository({
      fetchImpl: async () => new Response("boom", { status: 500 }),
    });
    await expect(repo.query(filter(), { limit: 10 })).rejects.toThrow(/500/);
  });

  it("returns a cursor only when the page was filled", async () => {
    const repo = createUsgsFdsnRepository({ fetchImpl: recordedFetch });
    const small = await repo.query(filter(), { limit: 5 });
    expect(small.cursor).toBe("5");
    const large = await repo.query(filter(), { limit: 10_000 });
    expect(large.cursor).toBeNull();
  });
});
