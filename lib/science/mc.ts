import { akiUtsu } from "./bvalue";
import { binMagnitudes, cumulativeFromBins, inferBinWidth } from "./magnitude";
import { mulberry32 } from "./random";
import { isRefusal, refuse, type Refusal } from "./refusal";

export interface McEstimate {
  mc: number;
  /** Bootstrap standard deviation (Woessner & Wiemer 2005). */
  sigma: number;
  method: "maxc" | "gft";
  n: number;
  binWidth: number;
}

const MIN_EVENTS_FOR_MC = 50;

function round(v: number, width: number): number {
  return Number((Math.round(v / width) * width).toFixed(4));
}

function maxcPoint(mags: number[], binWidth: number, correction: number): number | null {
  const bins = binMagnitudes(mags, binWidth);
  if (bins.counts.length === 0) return null;
  let best = 0;
  for (let i = 1; i < bins.counts.length; i++) if (bins.counts[i]! > bins.counts[best]!) best = i;
  return round(bins.edges[best]! + correction, binWidth);
}

function gftPoint(mags: number[], binWidth: number, level: number): number | null {
  const bins = binMagnitudes(mags, binWidth);
  const cum = cumulativeFromBins(bins);
  for (let i = 0; i < bins.edges.length; i++) {
    const mc = bins.edges[i]!;
    const est = akiUtsu(mags, mc, binWidth);
    if (isRefusal(est)) break; // higher candidates only have fewer events
    const a = Math.log10(cum[i]!) + est.b * mc;
    let resid = 0;
    let total = 0;
    for (let j = i; j < bins.edges.length; j++) {
      const synthetic = 10 ** (a - est.b * bins.edges[j]!);
      resid += Math.abs(cum[j]! - synthetic);
      total += cum[j]!;
    }
    const R = 100 - (100 * resid) / total;
    if (R >= level) return round(mc, binWidth);
  }
  return null;
}

function bootstrapSigma(
  mags: number[],
  point: (sample: number[]) => number | null,
  nBoot: number,
  seed: number,
): number {
  if (nBoot <= 1) return 0;
  const rng = mulberry32(seed);
  const values: number[] = [];
  const sample = new Array<number>(mags.length);
  for (let b = 0; b < nBoot; b++) {
    for (let i = 0; i < mags.length; i++) sample[i] = mags[Math.floor(rng() * mags.length)]!;
    const v = point(sample);
    if (v !== null) values.push(v);
  }
  if (values.length < 2) return 0;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));
}

export function mcMaxc(
  mags: number[],
  opts: { binWidth?: number; correction?: number; bootstrap?: number; seed?: number } = {},
): McEstimate | Refusal {
  if (mags.length < MIN_EVENTS_FOR_MC) {
    return refuse(`${mags.length} events; at least ${MIN_EVENTS_FOR_MC} are needed to estimate completeness.`);
  }
  const binWidth = opts.binWidth ?? inferBinWidth(mags);
  const correction = opts.correction ?? 0.2;
  const mc = maxcPoint(mags, binWidth, correction);
  if (mc === null) return refuse("No magnitude bins to estimate completeness from.");
  const sigma = bootstrapSigma(mags, (s) => maxcPoint(s, binWidth, correction), opts.bootstrap ?? 100, opts.seed ?? 1);
  return { mc, sigma, method: "maxc", n: mags.length, binWidth };
}

export function mcGft(
  mags: number[],
  opts: { binWidth?: number; level?: number; bootstrap?: number; seed?: number } = {},
): McEstimate | Refusal {
  if (mags.length < MIN_EVENTS_FOR_MC) {
    return refuse(`${mags.length} events; at least ${MIN_EVENTS_FOR_MC} are needed to estimate completeness.`);
  }
  const binWidth = opts.binWidth ?? inferBinWidth(mags);
  const level = opts.level ?? 90;
  const mc = gftPoint(mags, binWidth, level);
  if (mc === null) {
    return refuse(`No magnitude reaches a ${level}% Gutenberg-Richter goodness of fit.`);
  }
  const sigma = bootstrapSigma(mags, (s) => gftPoint(s, binWidth, level), opts.bootstrap ?? 50, opts.seed ?? 1);
  return { mc, sigma, method: "gft", n: mags.length, binWidth };
}

export function mcOverTime(
  events: { time: number; magnitude: number }[],
  opts: { window?: number; step?: number; seed?: number } = {},
): { timeMs: number; mc: number; sigma: number; n: number }[] {
  const window = opts.window ?? 200;
  const step = opts.step ?? Math.max(1, Math.floor(window / 4));
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const binWidth = inferBinWidth(sorted.map((e) => e.magnitude));
  const out: { timeMs: number; mc: number; sigma: number; n: number }[] = [];
  for (let start = 0; start + window <= sorted.length; start += step) {
    const slice = sorted.slice(start, start + window);
    const est = mcMaxc(slice.map((e) => e.magnitude), { binWidth, bootstrap: 50, seed: opts.seed ?? 1 });
    if (isRefusal(est)) continue;
    out.push({ timeMs: slice[Math.floor(window / 2)]!.time, mc: est.mc, sigma: est.sigma, n: window });
  }
  return out;
}

export function mcSpatial(
  events: { lat: number; lon: number; magnitude: number }[],
  opts: { cellDeg?: number; minPerCell?: number; seed?: number } = {},
): { lat: number; lon: number; mc: number; sigma: number; n: number }[] {
  const cell = opts.cellDeg ?? 0.5;
  const minPerCell = opts.minPerCell ?? MIN_EVENTS_FOR_MC;
  const groups = new Map<string, { lat: number; lon: number; mags: number[] }>();
  for (const e of events) {
    const i = Math.floor(e.lat / cell);
    const j = Math.floor(e.lon / cell);
    const key = `${i}:${j}`;
    let g = groups.get(key);
    if (!g) {
      g = { lat: (i + 0.5) * cell, lon: (j + 0.5) * cell, mags: [] };
      groups.set(key, g);
    }
    g.mags.push(e.magnitude);
  }
  const out: { lat: number; lon: number; mc: number; sigma: number; n: number }[] = [];
  for (const g of groups.values()) {
    if (g.mags.length < minPerCell) continue;
    const est = mcMaxc(g.mags, { bootstrap: 50, seed: opts.seed ?? 1 });
    if (isRefusal(est)) continue;
    out.push({ lat: g.lat, lon: g.lon, mc: est.mc, sigma: est.sigma, n: g.mags.length });
  }
  return out;
}
