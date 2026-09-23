import type { Event } from "../types";

export interface NormalizeReport {
  accepted: Event[];
  /** Every dropped record, with a reason. A silent drop hides a feed-shape
   *  change, and the count is the only evidence the shape changed. */
  rejected: { raw: unknown; reason: string }[];
}

export function emptyReport(): NormalizeReport {
  return { accepted: [], rejected: [] };
}

/** GeoJSON features, or an empty array for anything that is not a feature
 *  collection. Feed shapes change without notice; throwing on a bad payload
 *  would take the whole view down, and the rejected list is where evidence goes. */
export function features(input: unknown): unknown[] {
  if (typeof input !== "object" || input === null) return [];
  const f = (input as { features?: unknown }).features;
  return Array.isArray(f) ? f : [];
}

/** Coerce to a finite number, or null. Handles the string-encoded numbers both
 *  feeds occasionally emit. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Epoch seconds and epoch milliseconds are distinguished by magnitude: 1e11 ms
 *  is 1973 and 1e11 s is the year 5138, so the boundary is unambiguous for any
 *  date this application will ever see. EMSC sends fractional seconds. */
export function epochMs(v: number): number {
  return v < 1e11 ? Math.round(v * 1000) : v;
}
