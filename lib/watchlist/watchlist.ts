import type { Event } from "../events/types";
import { greatCircleKm } from "../science/distance";

/**
 * Watchlists live in this browser only (no accounts, nothing sent anywhere).
 * The digest is deliberately not an alert: it says what happened since the last
 * visit and sets it against what the same place usually does, in numbers.
 */

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  minMagnitude: number;
}

export interface WatchState {
  v: 1;
  places: Place[];
  /** When the digest was last read; null before the first visit. */
  lastVisit: number | null;
}

export const STORAGE_KEY = "seismograph.watchlist.v1";
export const MAX_PLACES = 20;
export const FIRST_VISIT_DAYS = 7;
export const REFERENCE_DAYS = 365;
const DAY = 86_400_000;

export const EMPTY: WatchState = { v: 1, places: [], lastVisit: null };

function isPlace(p: unknown): p is Place {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  const n = (k: string, lo: number, hi: number) => typeof o[k] === "number" && Number.isFinite(o[k]) && (o[k] as number) >= lo && (o[k] as number) <= hi;
  return typeof o.id === "string" && typeof o.name === "string" && n("lat", -90, 90) && n("lon", -180, 180) && n("radiusKm", 10, 2000) && n("minMagnitude", 4.5, 9.5);
}

/** Whatever is in storage, a valid state comes out: bad entries are dropped. */
export function parseState(raw: string | null): WatchState {
  if (raw === null) return EMPTY;
  try {
    const o = JSON.parse(raw) as Partial<WatchState>;
    const places = Array.isArray(o.places) ? o.places.filter(isPlace).slice(0, MAX_PLACES) : [];
    const lastVisit = typeof o.lastVisit === "number" && Number.isFinite(o.lastVisit) ? o.lastVisit : null;
    return { v: 1, places, lastVisit };
  } catch {
    return EMPTY;
  }
}

export function validatePlace(input: { name: string; lat: number; lon: number; radiusKm: number; minMagnitude: number }): string | null {
  if (input.name.trim() === "") return "Give the place a name.";
  if (!(input.lat >= -90 && input.lat <= 90)) return "Latitude must be between −90 and 90.";
  if (!(input.lon >= -180 && input.lon <= 180)) return "Longitude must be between −180 and 180.";
  if (!(input.radiusKm >= 10 && input.radiusKm <= 2000)) return "The radius must be between 10 and 2000 km.";
  if (!(input.minMagnitude >= 4.5 && input.minMagnitude <= 9.5)) return "The catalogue here starts at M4.5.";
  return null;
}

export function addPlace(s: WatchState, p: Omit<Place, "id">, id: string): WatchState {
  if (s.places.length >= MAX_PLACES) return s;
  return { ...s, places: [...s.places, { ...p, name: p.name.trim(), id }] };
}

export function removePlace(s: WatchState, id: string): WatchState {
  return { ...s, places: s.places.filter((p) => p.id !== id) };
}

/** The window the digest covers: since the last visit, or the past week on a first visit. */
export function digestWindow(lastVisit: number | null, now: number): { sinceMs: number; referenceStartMs: number } {
  const sinceMs = Math.min(lastVisit ?? now - FIRST_VISIT_DAYS * DAY, now - 60_000);
  return { sinceMs, referenceStartMs: sinceMs - REFERENCE_DAYS * DAY };
}

/** Smallest k with P(N ≤ k) ≥ q for N ~ Poisson(mu). */
export function poissonQuantile(mu: number, q: number): number {
  if (mu <= 0) return 0;
  let k = 0;
  let pk = Math.exp(-mu);
  let cdf = pk;
  // Normal approximation where the direct sum would underflow.
  if (pk === 0) return Math.max(0, Math.round(mu + (q < 0.5 ? -1 : 1) * 1.96 * Math.sqrt(mu)));
  while (cdf < q && k < 100_000) {
    k++;
    pk *= mu / k;
    cdf += pk;
  }
  return k;
}

export type Usual = "fewer" | "usual" | "more" | "no-reference";

export interface Digest {
  place: Place;
  since: Event[];
  largest: Event | null;
  /** Events per 30 days over the reference year before the window. */
  typicalPer30Days: number;
  expected: number;
  range95: [number, number];
  usual: Usual;
}

/**
 * `events` covers [referenceStart, now] around the place; this splits them into
 * the reference year and the window since the last visit.
 */
export function digest(place: Place, events: Event[], lastVisit: number | null, now: number): Digest {
  const { sinceMs, referenceStartMs } = digestWindow(lastVisit, now);
  const inside = events.filter((e) => e.magnitude >= place.minMagnitude && greatCircleKm(place.lat, place.lon, e.lat, e.lon) <= place.radiusKm);
  const since = inside.filter((e) => e.time >= sinceMs && e.time <= now).sort((a, b) => b.time - a.time);
  const reference = inside.filter((e) => e.time >= referenceStartMs && e.time < sinceMs).length;
  const perDay = reference / REFERENCE_DAYS;
  const expected = (perDay * (now - sinceMs)) / DAY;
  const range95: [number, number] = [poissonQuantile(expected, 0.025), poissonQuantile(expected, 0.975)];
  const n = since.length;
  const usual: Usual = reference === 0 && n === 0 ? "no-reference" : n < range95[0] ? "fewer" : n > range95[1] ? "more" : "usual";
  const largest = since.reduce<Event | null>((m, e) => (m === null || e.magnitude > m.magnitude ? e : m), null);
  return { place, since, largest, typicalPer30Days: perDay * 30, expected, range95, usual };
}

/** The sentence that goes with the numbers. No adjectives about danger. */
export function usualSentence(d: Digest): string {
  switch (d.usual) {
    case "no-reference": return "No M" + d.place.minMagnitude.toFixed(1) + "+ earthquakes here in the past year either.";
    case "fewer": return "Fewer than this area usually records in a period this long.";
    case "usual": return "Within the range this area usually records in a period this long.";
    case "more": return "More than this area usually records in a period this long. Busy periods are common after a larger earthquake and usually subside; the event pages show the sequence and its forecast.";
  }
}
