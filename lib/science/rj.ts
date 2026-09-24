/**
 * Reasenberg-Jones aftershock forecasting as the USGS Operational Aftershock
 * Forecasting system computes it: a posterior over an (a, p, c) grid with the
 * Page et al. (2016) time-varying completeness likelihood, and forecasts that
 * integrate over that posterior rather than using a point estimate.
 *
 * Validated against five published USGS forecasts (lib/science/rj.test.ts).
 */

export interface PageCompleteness {
  magCat: number;
  F: number;
  G: number;
  H: number;
}

/** Page et al. (2016): completeness is elevated and decays after a mainshock. */
export function pageMc(tDays: number, magMain: number, c: PageCompleteness): number {
  if (tDays <= 0) return Infinity;
  return Math.max(c.magCat, c.F * magMain - c.G - c.H * Math.log10(tDays));
}

export interface RjGrid {
  a: number[];
  p: number[];
  c: number[];
}

/** `n` evenly spaced values from lo to hi inclusive; one value when lo = hi. */
export function gridAxis(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo];
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

export interface GenericRj {
  aMean: number;
  aSigma: number;
  aSigma0: number;
  aSigma1: number;
  b: number;
  p: number;
  c: number;
}

/** The magnitude-dependent prior width USGS uses (GenericRJ_Parameters.get_aValueSigma). */
export function genericSigma(g: GenericRj, magMain: number): number {
  if (g.aSigma1 === 0) return g.aSigma;
  return Math.sqrt(g.aSigma0 ** 2 + g.aSigma1 ** 2 / 10 ** Math.max(magMain, 6));
}

export interface RjPosterior {
  grid: RjGrid;
  /** Normalised, indexed [ia][ip][ic] flattened. */
  weights: Float64Array;
  b: number;
  magMain: number;
  mean: { a: number; p: number; c: number };
  sd: { a: number; p: number; c: number };
  /** Aftershocks used by the likelihood: above completeness, inside the fit window. */
  n: number;
  /** Posterior mass on the first or last `a` value: the grid, not the data, bounds it. */
  edgeMass: number;
}

const LN10 = Math.LN10;
const QUAD_POINTS = 6000;
const QUAD_FLOOR_DAYS = 1e-9;

/** ∫ 10^(b(Mm − Mc(t))) (t+c)^−p dt over [t1, t2], trapezoid in ln t. */
function productivityIntegral(
  t1: number, t2: number, p: number, c: number, b: number, magMain: number, comp: PageCompleteness,
): number {
  const lo = Math.log(Math.max(t1, QUAD_FLOOR_DAYS));
  const hi = Math.log(t2);
  if (hi <= lo) return 0;
  const h = (hi - lo) / (QUAD_POINTS - 1);
  let sum = 0;
  for (let i = 0; i < QUAD_POINTS; i++) {
    const t = Math.exp(lo + i * h);
    const f = 10 ** (b * (magMain - pageMc(t, magMain, comp))) * (t + c) ** -p * t;
    sum += i === 0 || i === QUAD_POINTS - 1 ? f / 2 : f;
  }
  return sum * h;
}

export function rjPosterior(opts: {
  magMain: number;
  b: number;
  grid: RjGrid;
  /** Days after the mainshock, already filtered to the search region. */
  times: number[];
  mags: number[];
  fitStartDays: number;
  fitEndDays: number;
  completeness: PageCompleteness;
  prior?: { mean: number; sigma: number };
  /** False: the prior alone, with no likelihood (the generic model). */
  useData?: boolean;
}): RjPosterior {
  const { magMain, b, grid, completeness } = opts;
  const useData = opts.useData ?? true;
  const used: number[] = [];
  let sumMcTerm = 0;
  if (useData) {
    opts.times.forEach((t, i) => {
      if (t <= opts.fitStartDays || t > opts.fitEndDays) return;
      const mc = pageMc(t, magMain, completeness);
      if (opts.mags[i]! >= mc - 1e-9) {
        used.push(t);
        sumMcTerm += b * (magMain - mc) * LN10;
      }
    });
  }
  const n = used.length;
  const na = grid.a.length;
  const np = grid.p.length;
  const nc = grid.c.length;
  const logw = new Float64Array(na * np * nc);
  for (let ip = 0; ip < np; ip++) {
    for (let ic = 0; ic < nc; ic++) {
      const p = grid.p[ip]!;
      const c = grid.c[ic]!;
      let s = 0;
      let integral = 0;
      if (useData) {
        for (const t of used) s += Math.log(t + c);
        s = -p * s + sumMcTerm;
        integral = productivityIntegral(opts.fitStartDays, opts.fitEndDays, p, c, b, magMain, completeness);
      }
      for (let ia = 0; ia < na; ia++) {
        const a = grid.a[ia]!;
        let ll = useData ? n * a * LN10 + s - 10 ** a * integral : 0;
        if (opts.prior) ll += -0.5 * ((a - opts.prior.mean) / opts.prior.sigma) ** 2;
        logw[(ia * np + ip) * nc + ic] = ll;
      }
    }
  }
  let max = -Infinity;
  for (const v of logw) if (v > max) max = v;
  let total = 0;
  const weights = new Float64Array(logw.length);
  for (let i = 0; i < logw.length; i++) {
    weights[i] = Math.exp(logw[i]! - max);
    total += weights[i]!;
  }
  for (let i = 0; i < weights.length; i++) weights[i]! /= total;

  const marginal = (axis: "a" | "p" | "c") => {
    const len = grid[axis].length;
    const m = new Float64Array(len);
    for (let ia = 0; ia < na; ia++)
      for (let ip = 0; ip < np; ip++)
        for (let ic = 0; ic < nc; ic++) {
          const w = weights[(ia * np + ip) * nc + ic]!;
          m[axis === "a" ? ia : axis === "p" ? ip : ic]! += w;
        }
    let mean = 0;
    m.forEach((w, i) => (mean += w * grid[axis][i]!));
    let v = 0;
    m.forEach((w, i) => (v += w * (grid[axis][i]! - mean) ** 2));
    return { m, mean, sd: Math.sqrt(v) };
  };
  const A = marginal("a");
  const P = marginal("p");
  const C = marginal("c");
  const edgeMass = na > 1 ? A.m[0]! + A.m[na - 1]! : 0;
  return {
    grid, weights, b, magMain, n, edgeMass,
    mean: { a: A.mean, p: P.mean, c: C.mean },
    sd: { a: A.sd, p: P.sd, c: C.sd },
  };
}

/** ∫ (t+c)^−p dt over [t1, t2]. */
export function omoriIntegralRj(t1: number, t2: number, p: number, c: number): number {
  if (Math.abs(p - 1) < 1e-9) return Math.log((t2 + c) / (t1 + c));
  return ((t2 + c) ** (1 - p) - (t1 + c) ** (1 - p)) / (1 - p);
}

export interface RjForecastBin {
  magnitude: number;
  /** P(at least one) */
  probability: number;
  /** Posterior mean of the expected count. */
  expected: number;
  median: number;
  p95: [number, number];
  fractiles: number[];
  bars: number[];
}

// Lanczos approximation, g = 7, n = 9.
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let s = LANCZOS[0]!;
  for (let i = 1; i < 9; i++) s += LANCZOS[i]! / (x + i);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(s);
}

const MAX_COUNT = 2_000_000;

/** Counts forecast for [startDays, endDays] after the mainshock, integrated over
 *  the posterior: a mixture of Poissons, one per grid point. */
export function rjForecast(
  post: RjPosterior,
  startDays: number,
  endDays: number,
  magnitudes: number[],
  fractileProbabilities: number[],
  barLabels: number[],
): RjForecastBin[] {
  const { grid, weights, b, magMain } = post;
  const np = grid.p.length;
  const nc = grid.c.length;
  // The support: grid points carrying non-negligible mass.
  const support: { w: number; a: number; I: number }[] = [];
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    if (w < 1e-14) continue;
    const ia = Math.floor(i / (np * nc));
    const ip = Math.floor(i / nc) % np;
    const ic = i % nc;
    support.push({ w, a: grid.a[ia]!, I: omoriIntegralRj(startDays, endDays, grid.p[ip]!, grid.c[ic]!) });
  }
  return magnitudes.map((m) => {
    let probability = 0;
    let expected = 0;
    let hiK = 0;
    const lams = support.map((s) => {
      const lam = 10 ** (s.a + b * (magMain - m)) * s.I;
      probability += s.w * -Math.expm1(-lam);
      expected += s.w * lam;
      hiK = Math.max(hiK, Math.ceil(lam + 12 * Math.sqrt(lam) + 30));
      return lam;
    });
    hiK = Math.min(hiK, MAX_COUNT);
    const pmf = new Float64Array(hiK + 1);
    support.forEach((s, j) => {
      const lam = lams[j]!;
      const lo = Math.max(0, Math.floor(lam - 12 * Math.sqrt(lam) - 30));
      const hi = Math.min(hiK, Math.ceil(lam + 12 * Math.sqrt(lam) + 30));
      const lnLam = Math.log(Math.max(lam, 1e-300));
      for (let k = lo; k <= hi; k++) pmf[k]! += s.w * Math.exp(k * lnLam - lam - logGamma(k + 1));
    });
    const cdf = new Float64Array(pmf.length);
    let acc = 0;
    for (let k = 0; k < pmf.length; k++) cdf[k] = acc += pmf[k]!;
    const fractile = (q: number) => {
      let lo = 0;
      let hi = cdf.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid]! >= q - 1e-12) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    const bars = barLabels.map((from, i) => {
      const to = Math.min(barLabels[i + 1] ?? pmf.length, pmf.length);
      let s = 0;
      for (let k = from; k < to; k++) s += pmf[k]!;
      return Math.round(s * 100);
    });
    return {
      magnitude: m, probability, expected,
      median: fractile(0.5),
      p95: [fractile(0.025), fractile(0.975)],
      fractiles: fractileProbabilities.map(fractile),
      bars,
    };
  });
}
