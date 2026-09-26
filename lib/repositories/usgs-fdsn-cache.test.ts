import { describe, expect, it } from "vitest";
import { cacheWindow, createUsgsFdsnRepository } from "./usgs-fdsn";

const NOW = Date.UTC(2026, 8, 26, 10, 17, 43, 512);

describe("cache-friendly FDSN windows", () => {
  it("asks for whole minutes, the end of a recent window rounded up to 2", () => {
    const w = cacheWindow(NOW - 7 * 86_400_000 + 1234, NOW, NOW);
    expect(w.startMs % 60_000).toBe(0);
    expect(w.endMs % 120_000).toBe(0);
    expect(w.endMs).toBeGreaterThanOrEqual(NOW);
    expect(w.endMs - NOW).toBeLessThan(120_000);
    expect(w.revalidate).toBe(120);
  });

  it("makes two requests a few seconds apart share one URL", () => {
    expect(cacheWindow(NOW - 3_600_000, NOW, NOW)).toEqual(cacheWindow(NOW - 3_600_000 + 5_000, NOW + 5_000, NOW + 5_000));
  });

  it("caches history for a day", () => {
    expect(cacheWindow(Date.UTC(1976, 0, 1), Date.UTC(2019, 7, 1), NOW).revalidate).toBe(86_400);
  });

  it("cuts the answer back to the exact window, whatever the rounding fetched", async () => {
    const at = (ms: number, id: string) => ({
      type: "Feature", id,
      properties: { mag: 5, place: "x", time: ms, updated: ms, type: "earthquake", status: "reviewed", magType: "mb", url: "", net: "us", code: id, ids: `,${id},`, sources: ",us," },
      geometry: { type: "Point", coordinates: [0, 0, 10] },
    });
    const start = NOW - 60_000 * 30 + 7_000, end = NOW - 7_000;
    let asked = "";
    const fake = (async (url: string, init?: RequestInit) => {
      asked = url;
      expect((init as { next?: { revalidate?: number } }).next?.revalidate).toBe(120);
      return new Response(JSON.stringify({ type: "FeatureCollection", features: [at(start - 3_000, "early"), at(start + 1, "in1"), at(end, "in2"), at(end + 3_000, "late")] }));
    }) as unknown as typeof fetch;
    const page = await createUsgsFdsnRepository({ fetchImpl: fake }).query({ range: { startMs: start, endMs: end }, minMagnitude: 4.5, maxMagnitude: null, minDepthKm: null, maxDepthKm: null, bbox: null });
    expect(page.events.map((e) => e.id).sort()).toEqual(["usgs:in1", "usgs:in2"]);
    expect(asked).toMatch(/starttime=\d{4}-\d\d-\d\dT\d\d%3A\d\d%3A00&/);
  });
});
