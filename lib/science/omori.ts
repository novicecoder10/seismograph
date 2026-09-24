import { invert, nelderMeadMax, numericalHessian } from "./optimize";
import { refuse, type Refusal } from "./refusal";

export interface OmoriFit {
  K: number;
  c: number;
  p: number;
  sigma: { K: number; c: number; p: number } | null;
  ci95P: [number, number] | null;
  n: number;
  startDays: number;
  endDays: number;
  logLikelihood: number;
}

export const MIN_EVENTS_FOR_OMORI = 20;

const C_MIN = 1e-5;
const C_MAX = 10;
const P_MIN = 0.2;
const P_MAX = 3.0;

/** ∫_a^b (t + c)^-p dt, continuous through p = 1. */
export function omoriIntegral(c: number, p: number, a: number, b: number): number {
  if (Math.abs(p - 1) < 1e-6) return Math.log((b + c) / (a + c));
  return ((b + c) ** (1 - p) - (a + c) ** (1 - p)) / (1 - p);
}

export function omoriRate(fit: Pick<OmoriFit, "K" | "c" | "p">, tDays: number): number {
  return fit.K / (tDays + fit.c) ** fit.p;
}

/** Ogata (1983) maximum-likelihood fit of the modified Omori law. */
export function fitOmori(
  timesDays: number[],
  opts: { startDays?: number; endDays: number },
): OmoriFit | Refusal {
  const S = opts.startDays ?? 0;
  const T = opts.endDays;
  if (!(T > S)) return refuse("The fitting window is empty.");

  const t = timesDays.filter((x) => Number.isFinite(x) && x >= S && x <= T).sort((a, b) => a - b);
  const n = t.length;
  if (n < MIN_EVENTS_FOR_OMORI) {
    return refuse(
      `${n} aftershocks above completeness in the window; at least ${MIN_EVENTS_FOR_OMORI} are ` +
        "needed to fit a decay law.",
    );
  }

  const sumLog = (c: number) => {
    let s = 0;
    for (const ti of t) s += Math.log(ti + c);
    return s;
  };

  // Profile likelihood over (ln c, p), with K = n / I at its conditional MLE.
  const profile = ([lnC, p]: number[]) => {
    const c = Math.exp(lnC!);
    if (c < C_MIN || c > C_MAX || p! < P_MIN || p! > P_MAX) return -Infinity;
    const I = omoriIntegral(c, p!, S, T);
    if (!(I > 0)) return -Infinity;
    return n * Math.log(n / I) - p! * sumLog(c) - n;
  };

  // Coarse grid first: the likelihood surface in c is flat and has a ridge, and a
  // simplex started in the wrong place walks along it.
  let best = { lnC: Math.log(0.01), p: 1.0, v: -Infinity };
  for (let i = 0; i <= 30; i++) {
    const lnC = Math.log(C_MIN) + (i / 30) * (Math.log(C_MAX) - Math.log(C_MIN));
    for (let j = 0; j <= 30; j++) {
      const p = P_MIN + (j / 30) * (P_MAX - P_MIN);
      const v = profile([lnC, p]);
      if (v > best.v) best = { lnC, p, v };
    }
  }
  const refined = nelderMeadMax(profile, [best.lnC, best.p], [0.3, 0.05]);
  const c = Math.exp(refined.x[0]!);
  const p = refined.x[1]!;
  const K = n / omoriIntegral(c, p, S, T);

  // Full log-likelihood in (K, ln c, p) for the observed information matrix.
  const full = ([k, lnC, pp]: number[]) => {
    const cc = Math.exp(lnC!);
    return n * Math.log(k!) - pp! * sumLog(cc) - k! * omoriIntegral(cc, pp!, S, T);
  };
  const logLikelihood = full([K, Math.log(c), p]);

  let sigma: OmoriFit["sigma"] = null;
  let ci95P: OmoriFit["ci95P"] = null;
  const H = numericalHessian(full, [K, Math.log(c), p], [K * 1e-4, 1e-4, 1e-4]);
  const cov = invert(H.map((row) => row.map((v) => -v)));
  if (cov !== null) {
    const vK = cov[0]![0]!;
    const vLnC = cov[1]![1]!;
    const vP = cov[2]![2]!;
    if (vK > 0 && vLnC > 0 && vP > 0) {
      const sP = Math.sqrt(vP);
      // Delta method: σ_c = c · σ_lnc.
      sigma = { K: Math.sqrt(vK), c: c * Math.sqrt(vLnC), p: sP };
      ci95P = [p - 1.96 * sP, p + 1.96 * sP];
    }
  }

  return { K, c, p, sigma, ci95P, n, startDays: S, endDays: T, logLikelihood };
}

export interface OgataResult {
  points: { index: number; tau: number }[];
  total: number;
  ks: number;
  ksCritical95: number;
  consistent: boolean;
}

/** Ogata's transformed-time residual analysis. Under a correct model the
 *  transformed times are a unit-rate Poisson process, so τᵢ tracks i. */
export function ogataResiduals(timesDays: number[], fit: OmoriFit): OgataResult {
  const t = timesDays
    .filter((x) => Number.isFinite(x) && x >= fit.startDays && x <= fit.endDays)
    .sort((a, b) => a - b);
  const n = t.length;
  const total = fit.K * omoriIntegral(fit.c, fit.p, fit.startDays, fit.endDays);
  const points = t.map((ti, i) => ({
    index: i + 1,
    tau: fit.K * omoriIntegral(fit.c, fit.p, fit.startDays, ti),
  }));

  // Two-sided KS on the normalised transformed times against uniform.
  let ks = 0;
  points.forEach(({ tau }, i) => {
    const u = tau / total;
    ks = Math.max(ks, Math.abs((i + 1) / n - u), Math.abs(i / n - u));
  });
  const ksCritical95 = 1.36 / Math.sqrt(n);
  return { points, total, ks, ksCritical95, consistent: ks < ksCritical95 };
}
