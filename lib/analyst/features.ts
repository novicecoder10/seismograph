/**
 * Sequence features at an elapsed time, and similarity to past sequences.
 * All arithmetic lives here; the explainer's prose only ever quotes it.
 */

export const FLOOR_MAG = 4.5;
const C_DAYS = 0.018;

export interface LibrarySequence {
  id: string;
  name: string;
  time: number;
  lat: number;
  lon: number;
  depthKm: number | null;
  mag: number;
  place: string;
  radiusKm: number;
  /** [days after mainshock, magnitude, depth km | null], M4.5+, −30 d to +365 d. */
  events: [number, number, number | null][];
}

export interface Features {
  elapsedDays: number;
  /** M4.5+ aftershocks so far. */
  count: number;
  /** Reasenberg-Jones a-value implied by the count so far (p = 1, c = 0.018 d). */
  productivity: number;
  /** Largest aftershock so far, or null. */
  largest: number | null;
  /** Mainshock minus largest aftershock; null when there is none above M4.5. */
  bathGap: number | null;
  /** M4.5+ events in the 30 days before. */
  foreshocks: number;
}

export function featuresAt(mag: number, events: [number, number, number | null][], elapsedDays: number): Features {
  const after = events.filter(([t]) => t > 0 && t <= elapsedDays);
  const count = after.length;
  const largest = count ? Math.max(...after.map(([, m]) => m)) : null;
  const integral = Math.log((elapsedDays + C_DAYS) / C_DAYS);
  return {
    elapsedDays,
    count,
    productivity: Math.log10(count + 0.5) - (mag - FLOOR_MAG) - Math.log10(integral),
    largest,
    bathGap: largest === null ? null : mag - largest,
    foreshocks: events.filter(([t]) => t < 0 && t >= -30).length,
  };
}

export interface WhatNext {
  /** Window considered: from the elapsed time to a year after the mainshock. */
  fromDays: number;
  count: number;
  largest: { mag: number; days: number } | null;
  /** A later event at least as large as the mainshock. */
  largerFollowed: boolean;
}

export function whatHappenedNext(mag: number, events: [number, number, number | null][], fromDays: number): WhatNext {
  const later = events.filter(([t]) => t > fromDays && t <= 365);
  let largest: { mag: number; days: number } | null = null;
  for (const [t, m] of later) if (!largest || m > largest.mag) largest = { mag: m, days: t };
  return { fromDays, count: later.length, largest, largerFollowed: later.some(([, m]) => m >= mag) };
}

/** The gap enters the distance as a number; "no aftershock above M4.5 yet" is at
 *  least as large a gap as the largest possible below the floor. */
function gapValue(f: Features, mag: number): number {
  return f.bathGap ?? mag - FLOOR_MAG + 0.1;
}

export interface Match {
  seq: LibrarySequence;
  features: Features;
  distance: number;
  next: WhatNext;
}

/** Library sequences ranked by standardised distance on (productivity, Båth gap,
 *  foreshocks) at the same elapsed time. The target itself is excluded. */
export function rankSimilar(target: { id: string; mag: number; features: Features }, library: LibrarySequence[]): Match[] {
  const T = target.features.elapsedDays;
  const rows = library.filter((s) => s.id !== target.id).map((seq) => ({ seq, features: featuresAt(seq.mag, seq.events, T) }));
  const vec = (f: Features, mag: number) => [f.productivity, gapValue(f, mag), Math.log10(f.foreshocks + 1)];
  const all = [...rows.map((r) => vec(r.features, r.seq.mag)), vec(target.features, target.mag)];
  const sd = [0, 1, 2].map((k) => {
    const xs = all.map((v) => v[k]!);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.max(0.1, Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length));
  });
  const tv = vec(target.features, target.mag);
  return rows
    .map((r) => {
      const v = vec(r.features, r.seq.mag);
      const distance = Math.sqrt(v.reduce((s, x, k) => s + ((x - tv[k]!) / sd[k]!) ** 2, 0));
      return { ...r, distance, next: whatHappenedNext(r.seq.mag, r.seq.events, T) };
    })
    .sort((a, b) => a.distance - b.distance);
}
