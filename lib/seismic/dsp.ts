/**
 * Display signal processing. Nothing here removes the instrument response, so
 * processed traces are "as recorded, filtered", never ground motion in physical
 * units, and the UI says so.
 */

/** Remove the least-squares line, ignoring NaN gaps. */
export function detrend(x: Float32Array): Float32Array {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    if (Number.isNaN(v)) continue;
    n++; sx += i; sy += v; sxx += i * i; sxy += i * v;
  }
  const out = new Float32Array(x.length);
  if (n < 2) return out.fill(0);
  const d = n * sxx - sx * sx;
  const slope = d === 0 ? 0 : (n * sxy - sx * sy) / d;
  const icept = (sy - slope * sx) / n;
  for (let i = 0; i < x.length; i++) out[i] = Number.isNaN(x[i]!) ? 0 : x[i]! - (icept + slope * i);
  return out;
}

/** Cosine taper over `fraction` of each end. */
export function taper(x: Float32Array, fraction = 0.05): Float32Array {
  const out = Float32Array.from(x);
  const m = Math.floor(x.length * fraction);
  for (let i = 0; i < m; i++) {
    const w = 0.5 * (1 - Math.cos((Math.PI * i) / m));
    out[i]! *= w;
    out[x.length - 1 - i]! *= w;
  }
  return out;
}

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** RBJ cookbook second-order Butterworth sections (Q = 1/√2). */
function biquad(kind: "low" | "high", fc: number, fs: number): Biquad {
  const w = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w), alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b1 = kind === "low" ? 1 - cos : -(1 + cos);
  const b0 = kind === "low" ? (1 - cos) / 2 : (1 + cos) / 2;
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function run(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i]! + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/** Zero-phase band-pass: each section run forward then backward, so arrivals
 *  are not shifted in time by the filter. A limit at or above Nyquist is skipped. */
export function bandpass(x: Float32Array, fs: number, lowHz: number | null, highHz: number | null): Float32Array {
  const sections: Biquad[] = [];
  if (lowHz !== null && lowHz > 0 && lowHz < fs / 2) sections.push(biquad("high", lowHz, fs));
  if (highHz !== null && highHz > 0 && highHz < fs / 2) sections.push(biquad("low", highHz, fs));
  let y = x;
  for (const s of sections) {
    y = run(y, s);
    y = run(y.reverse(), s).reverse();
  }
  return y === x ? Float32Array.from(x) : y;
}

/** Peak |x| in consecutive windows of `step` samples, normalised to the trace's
 *  maximum: the station's brightness on the globe as recorded motion arrives. */
export function envelope(x: Float32Array, step: number): Float32Array {
  const n = Math.ceil(x.length / step);
  const out = new Float32Array(n);
  let max = 0;
  for (let k = 0; k < n; k++) {
    let m = 0;
    for (let i = k * step; i < Math.min(x.length, (k + 1) * step); i++) {
      const v = Math.abs(x[i]!);
      if (v > m) m = v; // NaN (a data gap) never compares greater, so it is skipped
    }
    out[k] = m;
    max = Math.max(max, m);
  }
  if (max > 0) for (let k = 0; k < n; k++) out[k]! /= max;
  return out;
}

/** Rotate two horizontals with sensor azimuths (degrees clockwise from north)
 *  to north and east. Works for any pair of orthogonal azimuths. */
export function rotateToNorthEast(h1: Float32Array, az1: number, h2: Float32Array, az2: number): { north: Float32Array; east: Float32Array } {
  const n = Math.min(h1.length, h2.length);
  const r1 = (az1 * Math.PI) / 180, r2 = (az2 * Math.PI) / 180;
  const north = new Float32Array(n), east = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    north[i] = h1[i]! * Math.cos(r1) + h2[i]! * Math.cos(r2);
    east[i] = h1[i]! * Math.sin(r1) + h2[i]! * Math.sin(r2);
  }
  return { north, east };
}
