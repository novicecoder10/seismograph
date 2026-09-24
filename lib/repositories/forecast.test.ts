import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventProducts } from "../events/products";
import type { Event } from "../events/types";
import type { EventRepository } from "./events";
import { centroid, loadForecast, searchRadiusKm } from "./forecast";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 12);

function ev(id: string, time: number, magnitude: number, lat = -20, lon = -70, source: Event["source"] = "usgs"): Event {
  return { id, source, sourceId: id.split(":")[1]!, time, lat, lon, depthKm: 30, magnitude, magType: "mww",
    place: "", status: "reviewed", felt: null, cdi: null, mmi: null, alert: null, tsunami: false, sig: null, url: null };
}

function repo(events: Event[]): EventRepository {
  return {
    name: "fake",
    async byId(id) { return events.find((e) => e.id === id) ?? null; },
    async query(f) { return { events: events.filter((e) => e.time >= f.range.startMs && e.time <= f.range.endMs && e.magnitude >= (f.minMagnitude ?? -9)), cursor: null, total: null }; },
  };
}

const noProducts = { name: "none", async byEvent() { return null; } };
const sz = () => ({ code: "SZ-GENERIC" as const, strec: "SZ (generic)" });

describe("loadForecast", () => {
  it("refuses below M5 with a reason", async () => {
    const r = await loadForecast("usgs:a", { events: repo([ev("usgs:a", T0, 4.7)]), products: noProducts, now: () => T0 + DAY, regime: sz });
    expect(r).toMatchObject({ kind: "refused", reason: expect.stringMatching(/M 5\.0 and above/) });
  });

  it("refuses after a year", async () => {
    const r = await loadForecast("usgs:a", { events: repo([ev("usgs:a", T0, 6.5)]), products: noProducts, now: () => T0 + 400 * DAY, regime: sz });
    expect(r).toMatchObject({ kind: "refused", reason: expect.stringMatching(/400 days old/) });
  });

  it("computes a Bayesian forecast in which aftershocks raise productivity above the generic prior", async () => {
    const after = Array.from({ length: 40 }, (_, i) => ev(`usgs:x${i}`, T0 + (i + 1) * 0.2 * DAY, 4.7 + (i % 4) * 0.2, -20.05, -70.02));
    const r = await loadForecast("usgs:m", { events: repo([ev("usgs:m", T0, 7.0), ...after]), products: noProducts, now: () => T0 + 10 * DAY, regime: sz });
    if (!("kind" in r) || r.kind !== "computed") throw new Error(JSON.stringify(r));
    expect(r.posterior.n).toBeGreaterThan(20);
    expect(r.posterior.mean.a).toBeGreaterThan(r.baseline.model.parameters.a!);
    const week = r.forecast.forecast[1]!;
    expect(week.label).toBe("1 Week");
    expect(week.timeStart % 3_600_000).toBe(0);
    for (const b of week.bins) {
      expect(b.probability).toBeGreaterThanOrEqual(0);
      expect(b.probability).toBeLessThanOrEqual(1);
      expect(b.p95minimum).toBeLessThanOrEqual(b.p95maximum);
    }
    // Probabilities fall with magnitude.
    const ps = week.bins.map((b) => b.probability);
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeLessThan(ps[i - 1]!);
    expect(week.aboveMainshockMag.magnitude).toBe(7.0);
  });

  it("with no aftershocks, forecasts below the generic prior rather than refusing", async () => {
    const r = await loadForecast("usgs:m", { events: repo([ev("usgs:m", T0, 6.0)]), products: noProducts, now: () => T0 + 30 * DAY, regime: sz });
    if (!("kind" in r) || r.kind !== "computed") throw new Error(JSON.stringify(r));
    expect(r.posterior.n).toBe(0);
    expect(r.posterior.mean.a).toBeLessThan(r.baseline.model.parameters.a!);
  });

  it("shows USGS's forecast, reproduced, where USGS issued one", async () => {
    const id = "ci38457511";
    const products = { name: "fake", async byEvent() {
      return { origins: [], shakemap: null, dyfi: null, pager: null, momentTensors: [], groundFailure: null,
        oaf: { forecastUrl: "f", forecastDataUrl: "d", updatedMs: 1 } } satisfies EventProducts;
    } };
    const fetchText = async (u: string) => readFileSync(`test/fixtures/oaf/${id}-${u === "f" ? "forecast" : "forecast_data"}.json`, "utf8");
    const r = await loadForecast(`usgs:${id}`, { events: repo([ev(`usgs:${id}`, T0, 7.1)]), products, fetchText, now: () => T0 });
    if (!("kind" in r) || r.kind !== "usgs") throw new Error(JSON.stringify(r));
    expect(r.reproduction!.maxRelError).toBeLessThan(0.005);
    expect(r.reproduction!.n).toBe(845);
  });

  it("does not substitute its own forecast when USGS's cannot be fetched", async () => {
    const products = { name: "fake", async byEvent() {
      return { origins: [], shakemap: null, dyfi: null, pager: null, momentTensors: [], groundFailure: null, oaf: { forecastUrl: "f", forecastDataUrl: null, updatedMs: null } } satisfies EventProducts;
    } };
    const r = await loadForecast("usgs:m", { events: repo([ev("usgs:m", T0, 6.0)]), products, fetchText: async () => { throw new Error("HTTP 503"); }, now: () => T0 + DAY, regime: sz });
    expect(r).toMatchObject({ error: expect.stringMatching(/None is computed here/) });
  });
});

describe("search region", () => {
  it("clips the Wells-Coppersmith length to 10-2000 km", () => {
    expect(searchRadiusKm(4)).toBe(10);
    expect(searchRadiusKm(7.1)).toBeCloseTo(10 ** (-3.22 + 0.69 * 7.1), 6);
    expect(searchRadiusKm(9.5)).toBe(2000);
  });

  it("takes a spherical centroid across the antimeridian", () => {
    const c = centroid([{ lat: 0, lon: 179 }, { lat: 0, lon: -179 }], { lat: 0, lon: 0 });
    expect(Math.abs(c.lon)).toBeCloseTo(180, 6);
    expect(centroid([], { lat: 1, lon: 2 })).toEqual({ lat: 1, lon: 2 });
  });
});
