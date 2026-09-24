import { mulberry32 } from "./random";
import { logGamma } from "./rj";

/**
 * Prospective forecast evaluation in the CSEP tradition (Zechar et al. 2010):
 * consistency of the observed count with the forecast distribution (N-test),
 * and skill relative to a reference model (information gain).
 */

export interface Mixture {
  /** Poisson rates, one per posterior support point. */
  lambdas: number[];
  weights: number[];
}

function logPoisson(n: number, lam: number): number {
  if (lam <= 0) return n === 0 ? 0 : -Infinity;
  return n * Math.log(lam) - lam - logGamma(n + 1);
}

/** P(N = n) under the mixture. */
export function mixturePmf(m: Mixture, n: number): number {
  let s = 0;
  m.lambdas.forEach((lam, i) => (s += m.weights[i]! * Math.exp(logPoisson(n, lam))));
  return s;
}

/** P(N ≤ n) under the mixture. */
export function mixtureCdf(m: Mixture, n: number): number {
  if (n < 0) return 0;
  let s = 0;
  m.lambdas.forEach((lam, i) => {
    let c = 0;
    for (let k = 0; k <= n; k++) c += Math.exp(logPoisson(k, lam));
    s += m.weights[i]! * Math.min(1, c);
  });
  return Math.min(1, s);
}

export interface NTest {
  observed: number;
  expected: number;
  /** P(N ≥ observed): small when the forecast predicted too few. */
  pAtLeast: number;
  /** P(N ≤ observed): small when the forecast predicted too many. */
  pAtMost: number;
  pass: boolean;
}

/** Two-sided N-test at 5%: fails when either tail is below 0.025. */
export function nTest(m: Mixture, observed: number): NTest {
  const pAtMost = mixtureCdf(m, observed);
  const pAtLeast = 1 - mixtureCdf(m, observed - 1);
  const expected = m.lambdas.reduce((s, lam, i) => s + lam * m.weights[i]!, 0);
  return { observed, expected, pAtLeast, pAtMost, pass: pAtLeast >= 0.025 && pAtMost >= 0.025 };
}

const EPS = 1e-12;

/** Binary log-loss of "at least one" (natural log; lower is better). */
export function logLoss(pAtLeastOne: number, happened: boolean): number {
  const p = Math.min(1 - EPS, Math.max(EPS, pAtLeastOne));
  return -(happened ? Math.log(p) : Math.log(1 - p));
}

/** ln P_model(n) − ln P_baseline(n), baseline Poisson. Positive: the model did better. */
export function informationGain(m: Mixture, baselineLambda: number, observed: number): number {
  const pm = Math.max(mixturePmf(m, observed), 1e-300);
  const pb = Math.max(Math.exp(logPoisson(observed, baselineLambda)), 1e-300);
  return Math.log(pm) - Math.log(pb);
}

/** Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + z ** 2 / n;
  const centre = (p + z ** 2 / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z ** 2 / (4 * n ** 2))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Mean and percentile-bootstrap 95% interval. */
export function bootstrapMean(values: number[], opts: { resamples?: number; seed?: number } = {}): { mean: number; ci95: [number, number] } | null {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, ci95: [mean, mean] };
  const rand = mulberry32(opts.seed ?? 1);
  const B = opts.resamples ?? 2000;
  const means: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)]!;
    means.push(s / n);
  }
  means.sort((x, y) => x - y);
  return { mean, ci95: [means[Math.floor(0.025 * B)]!, means[Math.ceil(0.975 * B) - 1]!] };
}
