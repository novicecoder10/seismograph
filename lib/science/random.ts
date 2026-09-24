/**
 * Mulberry32: a small, fast, seedable generator. Bootstrapped uncertainties must
 * be reproducible — a sequence page whose error bars change on every reload is
 * not a permanent URL, and a test that depends on Math.random is not a test.
 * Returns values in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Gutenberg-Richter catalogue with a known b, rounded to `binWidth`. Used by
 *  tests and by nothing in production. */
export function syntheticGutenbergRichter(
  n: number,
  b: number,
  mMin: number,
  binWidth: number,
  rng: () => number,
): number[] {
  const out: number[] = [];
  while (out.length < n) {
    const u = 1 - rng(); // (0, 1]
    const continuous = mMin - binWidth / 2 - Math.log10(u) / b;
    const rounded = Math.round(continuous / binWidth) * binWidth;
    if (rounded >= mMin - 1e-9) out.push(Number(rounded.toFixed(4)));
  }
  return out;
}
