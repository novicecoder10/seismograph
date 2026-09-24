import type { Event } from "../events/types";
import { bboxAround } from "../geo/bbox";
import type { EventRepository } from "../repositories/events";
import { baselineRate, computeForecast, MIN_MAGNITUDE } from "../repositories/forecast";
import { greatCircleKm } from "../science/distance";
import type { RegimeCode } from "../oaf/regimes";
import { informationGain, logLoss, mixturePmf, nTest } from "../science/scoring";
import { appendLine, parseLedger, serialiseLine, verifyLedger, type LedgerLine } from "./chain";
import { baselineLambda, buildForecastEntry, mixtureFor, windowEnd, type ForecastEntry, type ScoreEntry } from "./forecasts";

const DAY = 86_400_000;
/** Catalogue latency: a window is scored one day after it closes. */
export const SCORE_DELAY_MS = DAY;
/** Events are picked up for issuance while this recent. */
export const ISSUE_LOOKBACK_DAYS = 3;

export interface RunDeps {
  events: EventRepository;
  now: () => number;
  regime?: (lat: number, lon: number) => { code: RegimeCode; strec: string };
  log?: (msg: string) => void;
}

function assertIntact<T>(name: string, lines: LedgerLine<T>[]) {
  const broken = verifyLedger(lines);
  if (broken) throw new Error(`${name} is broken at line ${broken.index + 1}: ${broken.reason}. Refusing to append.`);
}

/** Issue a forecast for every eligible recent event that has none. Returns the text to append. */
export async function issueForecasts(forecastsText: string, deps: RunDeps): Promise<{ append: string; issued: string[]; skipped: string[] }> {
  const log = deps.log ?? (() => {});
  const lines = parseLedger<ForecastEntry>(forecastsText);
  assertIntact("forecasts ledger", lines);
  const have = new Set(lines.map((l) => l.entry.eventId));
  const now = deps.now();
  const page = await deps.events.query(
    { range: { startMs: now - ISSUE_LOOKBACK_DAYS * DAY, endMs: now }, minMagnitude: MIN_MAGNITUDE, maxMagnitude: null, minDepthKm: null, maxDepthKm: null, bbox: null },
    { limit: 2000 },
  );
  const out: LedgerLine<ForecastEntry>[] = [];
  const issued: string[] = [];
  const skipped: string[] = [];
  for (const event of page.events.sort((a, b) => a.time - b.time)) {
    if (have.has(event.id)) continue;
    const parent = [...lines, ...out].map((l) => l.entry).find((f) => partOfSequence(event, f));
    if (parent) {
      skipped.push(`${event.id}: part of the sequence of ${parent.eventId}, already forecast`);
      continue;
    }
    const r = await computeForecast(event, { events: deps.events, now: () => now, regime: deps.regime });
    if ("error" in r || r.kind !== "computed") {
      skipped.push(`${event.id}: ${"error" in r ? r.error : r.reason}`);
      continue;
    }
    const mcat = r.forecast.model.parameters.Mcat ?? 4.6;
    const baseline = await baselineRate({ lat: r.centroid.lat, lon: r.centroid.lon, radiusKm: r.searchRadiusKm }, mcat, event.time, deps.events);
    const entry = buildForecastEntry(r, baseline, now);
    out.push(appendLine([...lines, ...out], entry));
    issued.push(entry.id);
    log(`issued ${entry.id} (M${event.magnitude} ${event.place})`);
  }
  return { append: out.map(serialiseLine).join(""), issued, skipped };
}

/** Score every (forecast, window, magnitude) whose window has closed and is unscored. */
export async function scoreForecasts(forecastsText: string, scoresText: string, deps: RunDeps): Promise<{ append: string; scored: number }> {
  const forecasts = parseLedger<ForecastEntry>(forecastsText);
  const scores = parseLedger<ScoreEntry>(scoresText);
  assertIntact("forecasts ledger", forecasts);
  assertIntact("scores ledger", scores);
  const done = new Set(scores.map((s) => `${s.entry.forecastId}|${s.entry.window}|${s.entry.magnitude}`));
  const now = deps.now();
  const out: LedgerLine<ScoreEntry>[] = [];

  for (const line of forecasts) {
    const f = line.entry;
    for (let wi = 0; wi < f.windows.length; wi++) {
      const end = windowEnd(f, wi);
      if (end + SCORE_DELAY_MS > now) continue;
      const pending = f.scoredMagnitudes.filter((m) => !done.has(`${f.id}|${f.windows[wi]!.label}|${m}`));
      if (pending.length === 0) continue;
      const observedEvents = await observed(f, f.windowStart, end, Math.min(...pending), deps.events);
      for (const m of pending) {
        const n = observedEvents.filter((e) => e.magnitude >= m - 1e-9).length;
        const mix = mixtureFor(f, wi, m);
        const nt = nTest(mix, n);
        const lamB = baselineLambda(f, wi, m);
        const pModel = 1 - mixturePmf(mix, 0);
        const pBaseline = -Math.expm1(-lamB);
        const entry: ScoreEntry = {
          v: 1, forecastId: f.id, forecastHash: line.hash, window: f.windows[wi]!.label, windowEnd: end, magnitude: m,
          observed: n, expected: nt.expected, baselineExpected: lamB,
          pAtLeast: nt.pAtLeast, pAtMost: nt.pAtMost, pass: nt.pass,
          pModel, pBaseline,
          logLossModel: logLoss(pModel, n > 0), logLossBaseline: logLoss(pBaseline, n > 0),
          informationGain: informationGain(mix, lamB, n),
          scoredAt: now,
        };
        out.push(appendLine([...scores, ...out], entry));
        done.add(`${f.id}|${entry.window}|${m}`);
      }
    }
  }
  return { append: out.map(serialiseLine).join(""), scored: out.length };
}

/** An event is part of an already-forecast sequence when it follows a mainshock at
 *  least as large, within a year, inside that forecast's region. */
export function partOfSequence(event: Event, f: ForecastEntry): boolean {
  return f.magMain >= event.magnitude && f.mainshockTime < event.time && event.time - f.mainshockTime <= 365 * DAY &&
    greatCircleKm(f.region.lat, f.region.lon, event.lat, event.lon) <= f.region.radiusKm;
}

async function observed(f: ForecastEntry, startMs: number, endMs: number, minMagnitude: number, events: EventRepository): Promise<Event[]> {
  const page = await events.query(
    { range: { startMs, endMs }, minMagnitude, maxMagnitude: null, minDepthKm: null, maxDepthKm: null, bbox: bboxAround(f.region.lat, f.region.lon, f.region.radiusKm) },
    { limit: 20_000 },
  );
  return page.events.filter((e) => e.id !== f.eventId && e.time >= startMs && e.time <= endMs &&
    greatCircleKm(f.region.lat, f.region.lon, e.lat, e.lon) <= f.region.radiusKm);
}
