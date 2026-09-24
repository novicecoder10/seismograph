import { inferBinWidth } from "./magnitude";
import { refuse, type Refusal } from "./refusal";

export interface BValueEstimate {
  b: number;
  /** Shi & Bolt (1982) standard error. */
  sigma: number;
  /** b ± 1.96σ. Every b-value renders with this; the spec says always. */
  ci95: [number, number];
  n: number;
  mc: number;
  binWidth: number;
  method: "aki-utsu" | "b-positive";
}

/** Below this, Shi-Bolt's uncertainty is itself unreliable and the estimate is
 *  dominated by sampling noise. */
export const MIN_EVENTS_FOR_B = 50;

function estimate(
  values: number[],
  threshold: number,
  binWidth: number,
  method: BValueEstimate["method"],
  what: string,
): BValueEstimate | Refusal {
  const above = values.filter((v) => v >= threshold - 1e-9);
  const n = above.length;
  if (n < MIN_EVENTS_FOR_B) {
    return refuse(
      `${n} ${what} at or above ${threshold.toFixed(2)}; at least ${MIN_EVENTS_FOR_B} are needed ` +
        "for a b-value whose uncertainty means anything.",
    );
  }
  const mean = above.reduce((a, v) => a + v, 0) / n;
  const ss = above.reduce((a, v) => a + (v - mean) ** 2, 0);
  if (ss <= 1e-12) {
    return refuse(
      `The ${what} at or above ${threshold.toFixed(2)} do not vary, so b is undefined. ` +
        "A catalogue this uniform is rounded or synthetic.",
    );
  }
  const denom = mean - (threshold - binWidth / 2);
  if (denom <= 0) return refuse("The mean does not exceed the completeness threshold; b is undefined.");

  // Aki (1965), Utsu (1966).
  const b = Math.LOG10E / denom;
  // Shi & Bolt (1982). 2.30 is ln 10.
  const sigma = 2.3 * b * b * Math.sqrt(ss / (n * (n - 1)));
  return { b, sigma, ci95: [b - 1.96 * sigma, b + 1.96 * sigma], n, mc: threshold, binWidth, method };
}

export function akiUtsu(
  mags: number[],
  mc: number,
  binWidth: number = inferBinWidth(mags),
): BValueEstimate | Refusal {
  return estimate(mags, mc, binWidth, "aki-utsu", "events");
}

/**
 * van der Elst (2021). The positive differences between consecutive magnitudes
 * are exponentially distributed with the same β as the magnitudes themselves,
 * and are robust to the short-term incompleteness after a large event: a missed
 * small event removes a difference, it does not bias the ones that remain.
 */
export function bPositive(
  events: { time: number; magnitude: number }[],
  opts: { binWidth?: number; dc?: number } = {},
): BValueEstimate | Refusal {
  const binWidth = opts.binWidth ?? inferBinWidth(events.map((e) => e.magnitude));
  const dc = opts.dc ?? Math.max(0.2, 2 * binWidth);
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]!.magnitude - sorted[i - 1]!.magnitude;
    // Round away float noise so a 0.2 step is not 0.19999999.
    const rounded = Math.round(d / binWidth) * binWidth;
    if (rounded >= dc - 1e-9) diffs.push(rounded);
  }
  return estimate(diffs, dc, binWidth, "b-positive", "positive magnitude differences");
}
