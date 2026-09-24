const DEFAULT_BIN_WIDTH = 0.1;

export interface MagnitudeBins {
  /** Left edge of each bin, ascending. */
  edges: number[];
  counts: number[];
  binWidth: number;
}

/**
 * The reporting granularity of a catalogue, which the Aki-Utsu estimator needs
 * as ΔM. Assuming 0.1 for a catalogue rounded to 0.01 biases b low, so this is
 * measured rather than assumed.
 */
export function inferBinWidth(mags: number[]): number {
  const finite = mags.filter((m) => Number.isFinite(m));
  if (finite.length < 2) return DEFAULT_BIN_WIDTH;
  if (new Set(finite).size < 2) return DEFAULT_BIN_WIDTH;
  // The granularity is the LARGEST step every value is a multiple of — not the
  // smallest gap between values, which for [4.51, 4.62, 4.73] is 0.11. Coarse
  // steps need a real sample before they are believed: two values at 5.0 and
  // 5.5 do not make a half-unit catalogue.
  const candidates = finite.length >= 20 ? [0.5, 0.1, 0.05, 0.01, 0.001] : [0.1, 0.05, 0.01, 0.001];
  for (const step of candidates) {
    const multiple = finite.every((m) => Math.abs(m / step - Math.round(m / step)) < 1e-6);
    if (multiple) return step;
  }
  return 0.001;
}

export function binMagnitudes(mags: number[], binWidth?: number): MagnitudeBins {
  const width = binWidth ?? inferBinWidth(mags);
  if (mags.length === 0) return { edges: [], counts: [], binWidth: width };

  const min = Math.min(...mags);
  const max = Math.max(...mags);
  const first = Math.round(min / width) * width;
  const nBins = Math.max(1, Math.round((max - first) / width) + 1);

  const edges: number[] = [];
  const counts = new Array<number>(nBins).fill(0);
  for (let i = 0; i < nBins; i++) edges.push(first + i * width);

  for (const m of mags) {
    const idx = Math.min(nBins - 1, Math.max(0, Math.round((m - first) / width)));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return { edges, counts, binWidth: width };
}

/** N(≥M) for each bin: the cumulative frequency-magnitude distribution, which is
 *  the curve Gutenberg-Richter is a straight line on. */
export function cumulativeFromBins(bins: MagnitudeBins): number[] {
  const out = new Array<number>(bins.counts.length).fill(0);
  let running = 0;
  for (let i = bins.counts.length - 1; i >= 0; i--) {
    running += bins.counts[i] ?? 0;
    out[i] = running;
  }
  return out;
}
