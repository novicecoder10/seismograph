/**
 * A statistic that declines to be computed, with the reason. Spec §7: a number
 * from insufficient data is worse than no number, and the system says why rather
 * than guessing. Every estimator in lib/science returns this instead of NaN.
 */
export interface Refusal {
  refused: true;
  reason: string;
}

export function refuse(reason: string): Refusal {
  return { refused: true, reason };
}

export function isRefusal(v: unknown): v is Refusal {
  return typeof v === "object" && v !== null && (v as { refused?: unknown }).refused === true;
}
