import { describe, expect, it } from "vitest";
import type { Event } from "../events/types";
import type { EventRepository } from "../repositories/events";
import { computeForecast } from "../repositories/forecast";
import { mixturePmf } from "../science/scoring";
import { parseLedger } from "./chain";
import { baselineLambda, mixtureFor, type ForecastEntry, type ScoreEntry } from "./forecasts";
import { issueForecasts, scoreForecasts } from "./run";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 20, 6, 30);

function ev(id: string, time: number, magnitude: number, lat = -20, lon = -70): Event {
  return { id, source: "usgs", sourceId: id.split(":")[1]!, time, lat, lon, depthKm: 25, magnitude, magType: "mww",
    place: "offshore", status: "reviewed", felt: null, cdi: null, mmi: null, alert: null, tsunami: false, sig: null, url: null };
}

function repo(events: Event[]): EventRepository {
  return {
    name: "fake",
    async byId(id) { return events.find((e) => e.id === id) ?? null; },
    async query(f) {
      return { events: events.filter((e) => e.time >= f.range.startMs && e.time <= f.range.endMs && e.magnitude >= (f.minMagnitude ?? -9)), cursor: null, total: null };
    },
  };
}

const sz = () => ({ code: "SZ-GENERIC" as const, strec: "SZ (generic)" });
const main = ev("usgs:main", T0, 6.6);
const early = Array.from({ length: 8 }, (_, i) => ev(`usgs:e${i}`, T0 + (i + 1) * 0.05 * DAY, 4.8 + (i % 3) * 0.2, -20.02, -70.03));
const background = Array.from({ length: 40 }, (_, i) => ev(`usgs:bg${i}`, T0 - (400 + i * 150) * DAY, 4.7, -20.05, -70.05));
const ISSUE = T0 + 0.5 * DAY;

describe("issuing", () => {
  it("issues one forecast per eligible event, starting after issue, and is idempotent", async () => {
    const deps = { events: repo([main, ...early, ...background]), now: () => ISSUE, regime: sz };
    const first = await issueForecasts("", deps);
    expect(first.issued).toHaveLength(1);
    const [line] = parseLedger<ForecastEntry>(first.append);
    const f = line!.entry;
    expect(f.windowStart).toBeGreaterThanOrEqual(f.issuedAt);
    expect(f.windowStart % 3_600_000).toBe(0);
    expect(f.baseline.count).toBe(40);
    expect(f.scoredMagnitudes).toEqual([5, 6, 7, 6.6]);
    const again = await issueForecasts(first.append, deps);
    expect(again.issued).toHaveLength(0);
  });

  it("stores a posterior that reproduces the page's probabilities", async () => {
    const deps = { events: repo([main, ...early, ...background]), now: () => ISSUE, regime: sz };
    const { append } = await issueForecasts("", deps);
    const f = parseLedger<ForecastEntry>(append)[0]!.entry;
    const page = await computeForecast(main, deps);
    if ("error" in page || page.kind !== "computed") throw new Error("expected a forecast");
    for (const [wi, w] of page.forecast.forecast.entries()) {
      for (const b of w.bins.filter((x) => x.magnitude >= 5)) {
        const p = 1 - mixturePmf(mixtureFor(f, wi, b.magnitude), 0);
        expect(Math.abs(p - b.probability)).toBeLessThan(1e-6 + 1e-5 * b.probability);
      }
    }
  });

  it("refuses to append to a tampered ledger", async () => {
    const deps = { events: repo([main, ...early, ...background]), now: () => ISSUE, regime: sz };
    const { append } = await issueForecasts("", deps);
    const tampered = append.replace(/"magMain":6\.6/, '"magMain":6.7');
    await expect(issueForecasts(tampered, { ...deps, now: () => ISSUE + DAY })).rejects.toThrow(/broken at line 1/);
  });
});

describe("scoring", () => {
  it("scores closed windows only, counting what happened inside the circle", async () => {
    const inWindow = [ev("usgs:w1", ISSUE + 0.6 * DAY, 5.3, -20.01, -70.01), ev("usgs:far", ISSUE + 0.6 * DAY, 5.9, 10, 10)];
    const all = [main, ...early, ...background, ...inWindow];
    const deps = { events: repo(all), now: () => ISSUE, regime: sz };
    const { append: forecasts } = await issueForecasts("", deps);
    const f = parseLedger<ForecastEntry>(forecasts)[0]!.entry;

    const tooSoon = await scoreForecasts(forecasts, "", { ...deps, now: () => f.windowStart + 1.5 * DAY });
    expect(tooSoon.scored).toBe(0);

    const after = await scoreForecasts(forecasts, "", { ...deps, now: () => f.windowStart + 2.01 * DAY });
    const scores = parseLedger<ScoreEntry>(after.append).map((l) => l.entry);
    expect(scores.map((s) => s.window)).toEqual(["1 Day", "1 Day", "1 Day", "1 Day"]);
    const m5 = scores.find((s) => s.magnitude === 5)!;
    expect(m5.observed).toBe(1);
    expect(m5.baselineExpected).toBeCloseTo(baselineLambda(f, 0, 5), 12);
    expect(scores.find((s) => s.magnitude === 6)!.observed).toBe(0);
    for (const s of scores) {
      expect(Number.isFinite(s.informationGain)).toBe(true);
      expect(s.pModel).toBeGreaterThan(0);
    }

    const again = await scoreForecasts(forecasts, after.append, { ...deps, now: () => f.windowStart + 2.01 * DAY });
    expect(again.scored).toBe(0);
  });
});
