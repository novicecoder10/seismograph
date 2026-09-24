import { nextWholeHour, WINDOWS } from "../oaf/build";
import type { ForecastResult } from "../repositories/forecast";
import { omoriIntegralRj, type PageCompleteness } from "../science/rj";
import type { Mixture } from "../science/scoring";

const DAY = 86_400_000;
/** Posterior support below this weight is dropped from the ledger (sums to < 1e-6). */
const MIN_WEIGHT = 1e-9;

export interface ForecastEntry {
  v: 1;
  id: string;
  eventId: string;
  place: string;
  magMain: number;
  mainshockTime: number;
  lat: number;
  lon: number;
  depthKm: number | null;
  issuedAt: number;
  windowStart: number;
  windows: { label: string; days: number }[];
  region: { lat: number; lon: number; radiusKm: number };
  regime: string;
  completeness: PageCompleteness;
  aftershocksUsed: number;
  model: { b: number; p: number; c: number; a: number[]; w: number[] };
  baseline: { ratePerDayAtMcat: number; years: number; count: number; truncated: boolean };
  scoredMagnitudes: number[];
}

export interface ScoreEntry {
  v: 1;
  forecastId: string;
  /** Hash of the forecast's ledger line: the score is bound to exactly what was issued. */
  forecastHash: string;
  window: string;
  windowEnd: number;
  magnitude: number;
  observed: number;
  expected: number;
  baselineExpected: number;
  pAtLeast: number;
  pAtMost: number;
  pass: boolean;
  pModel: number;
  pBaseline: number;
  logLossModel: number;
  logLossBaseline: number;
  informationGain: number;
  scoredAt: number;
}

export function buildForecastEntry(
  r: Extract<ForecastResult, { kind: "computed" }>,
  baseline: ForecastEntry["baseline"],
  issuedAt: number,
): ForecastEntry {
  const post = r.posterior;
  if (post.grid.p.length !== 1 || post.grid.c.length !== 1) throw new Error("ledger stores Bayesian (a-only) posteriors");
  const a: number[] = [];
  const w: number[] = [];
  post.grid.a.forEach((av, i) => {
    const wv = post.weights[i]!;
    if (wv >= MIN_WEIGHT) {
      a.push(Number(av.toFixed(4)));
      w.push(Number(wv.toPrecision(8)));
    }
  });
  const total = w.reduce((x, y) => x + y, 0);
  const mcat = r.forecast.model.parameters.Mcat ?? 4.6;
  const e = r.event;
  return {
    v: 1,
    id: `${e.id}@${issuedAt}`,
    eventId: e.id, place: e.place, magMain: e.magnitude, mainshockTime: e.time,
    lat: e.lat, lon: e.lon, depthKm: e.depthKm,
    issuedAt, windowStart: nextWholeHour(issuedAt),
    windows: WINDOWS.map((x) => ({ label: x.label, days: x.days })),
    region: { lat: Number(r.centroid.lat.toFixed(4)), lon: Number(r.centroid.lon.toFixed(4)), radiusKm: Number(r.searchRadiusKm.toFixed(2)) },
    regime: r.regime.code,
    completeness: { magCat: mcat, F: r.forecast.model.parameters.F ?? 0.5, G: r.forecast.model.parameters.G ?? 0.25, H: r.forecast.model.parameters.H ?? 1 },
    aftershocksUsed: post.n,
    model: { b: post.b, p: post.grid.p[0]!, c: post.grid.c[0]!, a, w: w.map((x) => Number((x / total).toPrecision(8))) },
    baseline,
    scoredMagnitudes: [...[5, 6, 7].filter((m) => m >= mcat), e.magnitude],
  };
}

export function windowEnd(f: ForecastEntry, windowIndex: number): number {
  return f.windowStart + f.windows[windowIndex]!.days * DAY;
}

/** The forecast count distribution for one window and magnitude, exactly as issued. */
export function mixtureFor(f: ForecastEntry, windowIndex: number, magnitude: number): Mixture {
  const t1 = (f.windowStart - f.mainshockTime) / DAY;
  const t2 = (windowEnd(f, windowIndex) - f.mainshockTime) / DAY;
  const I = omoriIntegralRj(t1, t2, f.model.p, f.model.c);
  return {
    lambdas: f.model.a.map((a) => 10 ** (a + f.model.b * (f.magMain - magnitude)) * I),
    weights: f.model.w,
  };
}

export function baselineLambda(f: ForecastEntry, windowIndex: number, magnitude: number): number {
  return f.baseline.ratePerDayAtMcat * 10 ** (-f.model.b * (magnitude - f.completeness.magCat)) * f.windows[windowIndex]!.days;
}
