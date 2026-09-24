import { describe, expect, it } from "vitest";
import { appendLine, serialiseLine, type LedgerLine } from "./chain";
import type { ForecastEntry, ScoreEntry } from "./forecasts";
import { MIN_FOR_VERDICT, summarise } from "./summary";

const DAY = 86_400_000;
const T = Date.UTC(2026, 8, 25);

function forecast(i: number): ForecastEntry {
  return {
    v: 1, id: `usgs:e${i}@${T}`, eventId: `usgs:e${i}`, place: `place ${i}`, magMain: 6, mainshockTime: T - DAY,
    lat: 0, lon: 0, depthKm: 10, issuedAt: T, windowStart: T, windows: [{ label: "1 Day", days: 1 }, { label: "1 Week", days: 7 }],
    region: { lat: 0, lon: 0, radiusKm: 30 }, regime: "SZ-GENERIC", completeness: { magCat: 4.6, F: 0.5, G: 0.25, H: 1 },
    aftershocksUsed: 3, model: { b: 1, p: 1, c: 0.018, a: [-2.5], w: [1] },
    baseline: { ratePerDayAtMcat: 0.01, years: 20, count: 73, truncated: false }, scoredMagnitudes: [5],
  };
}

function build(n: number, gain: (i: number) => number, pass = (_i: number) => true) {
  const fl: LedgerLine<ForecastEntry>[] = [];
  const sl: LedgerLine<ScoreEntry>[] = [];
  for (let i = 0; i < n; i++) {
    fl.push(appendLine(fl, forecast(i)));
    sl.push(appendLine(sl, {
      v: 1, forecastId: fl[i]!.entry.id, forecastHash: fl[i]!.hash, window: "1 Day", windowEnd: T + DAY, magnitude: 5,
      observed: i % 3 === 0 ? 1 : 0, expected: 0.3, baselineExpected: 0.01, pAtLeast: 0.5, pAtMost: 0.9, pass: pass(i),
      pModel: 0.3, pBaseline: 0.01, logLossModel: 0.5, logLossBaseline: 0.9, informationGain: gain(i), scoredAt: T + 2 * DAY,
    }));
  }
  return { f: fl.map(serialiseLine).join(""), s: sl.map(serialiseLine).join("") };
}

describe("scoreboard summary", () => {
  it("says nothing is scored yet, and when the first window closes", () => {
    const { f } = build(2, () => 0);
    const sb = summarise(f, "", T);
    expect(sb.verdict).toBe("none-scored");
    expect(sb.pending.windows).toBe(4);
    expect(sb.pending.nextScoredAt).toBe(T + 2 * DAY);
  });

  it("withholds a verdict below the minimum sample", () => {
    const { f, s } = build(MIN_FOR_VERDICT - 1, () => 1);
    expect(summarise(f, s, T).verdict).toBe("too-few");
  });

  it("says plainly when the model does not beat the baseline", () => {
    const { f, s } = build(40, (i) => -1 - (i % 3) * 0.1);
    const sb = summarise(f, s, T + 3 * DAY);
    expect(sb.verdict).toBe("does-not-beat");
    expect(sb.informationGain!.ci95[1]).toBeLessThan(0);
  });

  it("calls an interval straddling zero indistinguishable", () => {
    const { f, s } = build(40, (i) => (i % 2 ? 1 : -1));
    expect(summarise(f, s, T + 3 * DAY).verdict).toBe("indistinguishable");
  });

  it("lists every failure with its place", () => {
    const { f, s } = build(10, () => 0, (i) => i !== 4);
    const sb = summarise(f, s, T + 3 * DAY);
    expect(sb.failures).toHaveLength(1);
    expect(sb.failures[0]!.place).toBe("place 4");
    expect(sb.nTest).toMatchObject({ passed: 9, total: 10 });
  });

  it("reports a broken ledger and ignores scores not bound to an intact forecast", () => {
    const { f, s } = build(3, () => 1);
    const tampered = f.replace('"magMain":6', '"magMain":7');
    const sb = summarise(tampered, s, T + 3 * DAY);
    expect(sb.integrity.problem).toMatch(/forecast ledger is broken at line 1/);
    expect(sb.scored).toBe(3); // hashes still match the stored hash field...
    const forged = s.replace(/"forecastHash":"[0-9a-f]{64}"/, `"forecastHash":"${"f".repeat(64)}"`);
    expect(summarise(f, forged, T).scored).toBe(2); // ...but a score pointing at no real line is dropped
  });
});
