import { greatCircleKm } from "../science/distance";
import { parseNdk, type Mechanism } from "./mechanism";

const BASE = "https://www.ldeo.columbia.edu/~gcmt/projects/CMT/catalog";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export const MAX_SPAN_MS = 3 * 366 * 86_400_000;

export function monthlyUrl(year: number, month: number): string {
  return `${BASE}/NEW_MONTHLY/${year}/${MONTHS[month]}${String(year % 100).padStart(2, "0")}.ndk`;
}
export const QUICK_URL = `${BASE}/NEW_QUICK/qcmt.ndk`;

/** Months (UTC year, 0-based month) overlapping [from, to]. */
export function monthsBetween(fromMs: number, toMs: number): [number, number][] {
  const out: [number, number][] = [];
  const d = new Date(fromMs);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  const end = new Date(toMs);
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth())) {
    out.push([y, m]);
    if (++m === 12) { m = 0; y++; }
  }
  return out;
}

/** Quick and monthly solutions overlap; the reviewed monthly one wins. */
export function dedupe(ms: Mechanism[]): Mechanism[] {
  const kept: Mechanism[] = [];
  for (const m of ms) {
    const dup = kept.find((k) => k.id === m.id || (Math.abs(k.time - m.time) < 15_000 && greatCircleKm(k.lat, k.lon, m.lat, m.lon) < 60));
    if (!dup) kept.push(m);
  }
  return kept;
}

/**
 * Mechanisms with centroid time in [from, to]: reviewed monthly files for every
 * month that has one, and the quick catalogue for the rest. A missing monthly
 * file (not yet published) is not an error.
 */
export async function fetchMechanisms(fromMs: number, toMs: number, fetchText: (url: string, revalidate: number) => Promise<string | null>): Promise<Mechanism[]> {
  if (toMs - fromMs > MAX_SPAN_MS) throw new Error("range too long: at most three years of mechanisms at once");
  const monthly = await Promise.all(monthsBetween(fromMs, toMs).map(([y, m]) => fetchText(monthlyUrl(y, m), 7 * 86400)));
  const quick = await fetchText(QUICK_URL, 3600);
  const all = [...monthly.flatMap((t) => (t ? parseNdk(t) : [])), ...(quick ? parseNdk(quick) : [])];
  return dedupe(all.filter((m) => m.time >= fromMs && m.time <= toMs)).sort((a, b) => a.time - b.time);
}

/** Server-side NDK fetch with Next's data cache: a 404 is a month not yet published. */
export async function cachedFetchText(u: string, revalidate: number): Promise<string | null> {
  const res = await fetch(u, { next: { revalidate } } as RequestInit);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GCMT ${res.status}`);
  return res.text();
}
