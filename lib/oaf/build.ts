import { decodeCatalog } from "./compact";
import { BAR_LABELS, FRACTILE_PROBABILITIES, type OafForecast, type OafWindow } from "./types";
import { genericSigma, gridAxis, rjForecast, rjPosterior, type PageCompleteness, type RjPosterior } from "../science/rj";

const DAY = 86_400_000;

export const WINDOWS = [
  { label: "1 Day", days: 1 },
  { label: "1 Week", days: 7 },
  { label: "1 Month", days: 30 },
  { label: "1 Year", days: 365 },
] as const;

export const FORECAST_MAGNITUDES = [3, 4, 5, 6, 7];

/** Forecasts start at the next whole hour after issue, as USGS's do. */
export function nextWholeHour(ms: number): number {
  return Math.ceil(ms / 3_600_000) * 3_600_000;
}

/** Render a posterior into the same shape USGS publishes, so one view shows both. */
export function toOafForecast(opts: {
  post: RjPosterior;
  modelName: string;
  mainshockTime: number;
  issuedAt: number;
  completeness: PageCompleteness;
  region: { lat: number; lon: number; radiusKm: number };
  observations?: { magnitude: number; count: number }[];
}): OafForecast {
  const { post, mainshockTime } = opts;
  const start = nextWholeHour(opts.issuedAt);
  const forecast: OafWindow[] = WINDOWS.map((w) => {
    const end = start + w.days * DAY;
    const bins = rjForecast(post, (start - mainshockTime) / DAY, (end - mainshockTime) / DAY,
      [...FORECAST_MAGNITUDES, post.magMain], FRACTILE_PROBABILITIES, BAR_LABELS);
    const toBin = (b: (typeof bins)[number]) => ({
      magnitude: b.magnitude, probability: b.probability, median: b.median,
      p95minimum: b.p95[0], p95maximum: b.p95[1], fractileValues: b.fractiles, barPercentages: b.bars,
    });
    const above = bins[bins.length - 1]!;
    return {
      timeStart: start, timeEnd: end, label: w.label,
      bins: bins.slice(0, -1).map(toBin),
      aboveMainshockMag: { magnitude: above.magnitude, probability: above.probability, fractileValues: above.fractiles, barPercentages: above.bars },
    };
  });
  return {
    creationTime: opts.issuedAt,
    advisoryTimeFrame: "1 Year",
    observations: opts.observations,
    model: {
      name: opts.modelName,
      parameters: {
        a: post.mean.a, b: post.b, magMain: post.magMain, p: post.mean.p, c: post.mean.c,
        aSigma: post.grid.a.length > 1 ? post.sd.a : 0,
        pSigma: post.grid.p.length > 1 ? post.sd.p : 0,
        Mcat: opts.completeness.magCat, F: opts.completeness.F, G: opts.completeness.G, H: opts.completeness.H,
        regionType: "circle", regionCenterLat: opts.region.lat, regionCenterLon: opts.region.lon, regionRadius: opts.region.radiusKm,
      },
    },
    fractileProbabilities: FRACTILE_PROBABILITIES,
    barLabels: BAR_LABELS,
    forecast,
  };
}

/**
 * Rebuild a published USGS forecast from its own forecast_data.json and return
 * the largest relative difference between USGS's probabilities and ours. This
 * is the regression test from rj.test.ts, run live on every USGS forecast shown.
 * Returns null for model types this project does not implement (e.g. ETAS).
 */
export function reproduceUsgs(published: OafForecast, dataText: string): { maxRelError: number; n: number } | null {
  const fd = JSON.parse(dataText);
  const t0: number = fd.mainshock.mainshock_time;
  const magMain: number = fd.mainshock.mainshock_mag;
  const mc = fd.parameters.mag_comp_params;
  const completeness = { magCat: mc.magCat, F: mc.magCompFn.capF, G: mc.magCompFn.capG, H: mc.magCompFn.capH };
  const r = fd.results;
  const cat = decodeCatalog(dataText);
  const common = {
    magMain, completeness,
    times: cat.map((e) => (e.time - t0) / DAY),
    mags: cat.map((e) => e.magnitude),
    fitStartDays: r.catalog_fit_start_days,
    fitEndDays: r.catalog_fit_end_days,
  };
  let post: RjPosterior;
  const name = published.model.name;
  if (name.includes("Sequence Specific") && r.seq_spec_summary) {
    const s = r.seq_spec_summary;
    post = rjPosterior({ ...common, b: s.b, grid: { a: gridAxis(s.min_a, s.max_a, s.num_a), p: gridAxis(s.min_p, s.max_p, s.num_p), c: gridAxis(s.min_c, s.max_c, s.num_c) } });
  } else if (name.includes("Bayesian") && r.bayesian_summary) {
    const g = fd.parameters.generic_params;
    const s = r.bayesian_summary;
    const generic = { aMean: g.aValue_mean, aSigma: g.aValue_sigma, aSigma0: g.aValue_sigma0, aSigma1: g.aValue_sigma1, b: g.bValue, p: g.pValue, c: g.cValue };
    post = rjPosterior({ ...common, b: s.b, grid: { a: gridAxis(s.min_a, s.max_a, s.num_a), p: [g.pValue], c: [g.cValue] }, prior: { mean: generic.aMean, sigma: genericSigma(generic, magMain) } });
  } else if (name.includes("Generic") && r.generic_summary) {
    const g = fd.parameters.generic_params;
    const s = r.generic_summary;
    const generic = { aMean: g.aValue_mean, aSigma: g.aValue_sigma, aSigma0: g.aValue_sigma0, aSigma1: g.aValue_sigma1, b: g.bValue, p: g.pValue, c: g.cValue };
    post = rjPosterior({ ...common, b: s.b, grid: { a: gridAxis(s.min_a, s.max_a, s.num_a), p: [g.pValue], c: [g.cValue] }, prior: { mean: generic.aMean, sigma: genericSigma(generic, magMain) }, useData: false });
  } else {
    return null;
  }
  let maxRelError = 0;
  for (const w of published.forecast) {
    const pubs = [...w.bins, w.aboveMainshockMag];
    const ours = rjForecast(post, (w.timeStart - t0) / DAY, (w.timeEnd - t0) / DAY, pubs.map((b) => b.magnitude), [0.5], [0]);
    pubs.forEach((pub, i) => {
      if (pub.probability < 1e-6) return; // four published figures carry no more
      maxRelError = Math.max(maxRelError, Math.abs(ours[i]!.probability - pub.probability) / pub.probability);
    });
  }
  return { maxRelError, n: post.n };
}
