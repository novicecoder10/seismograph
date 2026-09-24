/** A probability as a person reads it: never "0%" for something possible, never
 *  "100%" for something uncertain, two significant figures below 10%. */
export function formatProbability(p: number): string {
  if (!Number.isFinite(p) || p < 0) return "—";
  if (p === 0) return "0%";
  if (p < 0.0001) return "<0.01%";
  if (p > 0.99) return ">99%";
  const pct = p * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  return `${Number(pct.toPrecision(2))}%`;
}

export function formatRange(lo: number, hi: number): string {
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}
