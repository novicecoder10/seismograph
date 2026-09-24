import { bootstrapMean, wilson } from "../science/scoring";
import { parseLedger, verifyLedger } from "./chain";
import { windowEnd, type ForecastEntry, type ScoreEntry } from "./forecasts";
import { SCORE_DELAY_MS } from "./run";

/** Below this many scored forecasts the verdict is "too few to judge". */
export const MIN_FOR_VERDICT = 30;

export const CALIBRATION_BINS: [number, number][] = [[0, 0.01], [0.01, 0.05], [0.05, 0.2], [0.2, 0.5], [0.5, 1.000001]];

export type Verdict = "none-scored" | "too-few" | "beats" | "does-not-beat" | "indistinguishable";

export interface Scoreboard {
  integrity: { forecasts: number; scores: number; problem: string | null };
  verdict: Verdict;
  scored: number;
  informationGain: { mean: number; ci95: [number, number] } | null;
  nTest: { passed: number; total: number; ci95: [number, number] };
  logLoss: { model: number; baseline: number } | null;
  calibration: { lo: number; hi: number; n: number; meanForecast: number; observed: number; ci95: [number, number] }[];
  failures: (ScoreEntry & { place: string; magMain: number })[];
  pending: { windows: number; nextScoredAt: number | null };
  forecasts: ForecastEntry[];
}

export function summarise(forecastsText: string, scoresText: string, now: number): Scoreboard {
  const fl = parseLedger<ForecastEntry>(forecastsText);
  const sl = parseLedger<ScoreEntry>(scoresText);
  const fb = verifyLedger(fl);
  const sb = verifyLedger(sl);
  const problem = fb
    ? `The forecast ledger is broken at line ${fb.index + 1}: ${fb.reason}.`
    : sb
      ? `The score ledger is broken at line ${sb.index + 1}: ${sb.reason}.`
      : null;

  const forecasts = fl.map((l) => l.entry);
  const byId = new Map(forecasts.map((f) => [f.id, f]));
  const hashes = new Set(fl.map((l) => l.hash));
  // A score counts only if it is bound to a forecast line that exists unchanged.
  const scores = sl.map((l) => l.entry).filter((s) => byId.has(s.forecastId) && hashes.has(s.forecastHash));

  const ig = bootstrapMean(scores.map((s) => s.informationGain), { seed: 7 });
  const passed = scores.filter((s) => s.pass).length;
  let verdict: Verdict;
  if (scores.length === 0) verdict = "none-scored";
  else if (scores.length < MIN_FOR_VERDICT) verdict = "too-few";
  else if (ig!.ci95[0] > 0) verdict = "beats";
  else if (ig!.ci95[1] < 0) verdict = "does-not-beat";
  else verdict = "indistinguishable";

  const calibration = CALIBRATION_BINS.map(([lo, hi]) => {
    const inBin = scores.filter((s) => s.pModel >= lo && s.pModel < hi);
    const k = inBin.filter((s) => s.observed > 0).length;
    return {
      lo, hi: Math.min(hi, 1), n: inBin.length,
      meanForecast: inBin.length ? inBin.reduce((a, s) => a + s.pModel, 0) / inBin.length : (lo + Math.min(hi, 1)) / 2,
      observed: inBin.length ? k / inBin.length : 0,
      ci95: wilson(k, inBin.length),
    };
  });

  const scoredKeys = new Set(scores.map((s) => `${s.forecastId}|${s.window}`));
  let pendingWindows = 0;
  let nextScoredAt: number | null = null;
  for (const f of forecasts) {
    f.windows.forEach((w, i) => {
      if (scoredKeys.has(`${f.id}|${w.label}`)) return;
      pendingWindows++;
      const at = windowEnd(f, i) + SCORE_DELAY_MS;
      if (at > now && (nextScoredAt === null || at < nextScoredAt)) nextScoredAt = at;
    });
  }

  return {
    integrity: { forecasts: fl.length, scores: sl.length, problem },
    verdict,
    scored: scores.length,
    informationGain: ig,
    nTest: { passed, total: scores.length, ci95: wilson(passed, scores.length) },
    logLoss: scores.length
      ? { model: scores.reduce((a, s) => a + s.logLossModel, 0) / scores.length, baseline: scores.reduce((a, s) => a + s.logLossBaseline, 0) / scores.length }
      : null,
    calibration,
    failures: scores.filter((s) => !s.pass).map((s) => ({ ...s, place: byId.get(s.forecastId)!.place, magMain: byId.get(s.forecastId)!.magMain })),
    pending: { windows: pendingWindows, nextScoredAt },
    forecasts: [...forecasts].sort((a, b) => b.issuedAt - a.issuedAt),
  };
}
