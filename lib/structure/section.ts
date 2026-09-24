import { downDipAzimuth, slabDepthAt, type Slab } from "./slab2";

const R = 6371.0088;
const D = Math.PI / 180;

export interface Profile {
  /** Centre point and azimuth (degrees clockwise from north) of the section line. */
  lat: number;
  lon: number;
  azimuthDeg: number;
  halfLengthKm: number;
  halfWidthKm: number;
  /** Why this orientation was chosen, for the page to say. */
  orientation: "down-dip" | "east-west";
  slab: string | null;
}

/** The point `km` along a great circle from (lat, lon) at `azimuth`. */
export function destination(lat: number, lon: number, azimuthDeg: number, km: number): { lat: number; lon: number } {
  const d = km / R, b = azimuthDeg * D, p1 = lat * D, l1 = lon * D;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / D, lon: ((((l2 / D) + 540) % 360) - 180) };
}

/** Signed along-track distance from the centre (positive toward the azimuth) and
 *  cross-track distance, both in km. */
export function projectOnto(p: Profile, lat: number, lon: number): { alongKm: number; acrossKm: number } {
  const p1 = p.lat * D, l1 = p.lon * D, p2 = lat * D, l2 = lon * D;
  const d13 = Math.acos(Math.min(1, Math.max(-1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(l2 - l1))));
  const b13 = Math.atan2(Math.sin(l2 - l1) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1));
  const b12 = p.azimuthDeg * D;
  const xt = Math.asin(Math.sin(d13) * Math.sin(b13 - b12));
  const at = Math.acos(Math.min(1, Math.max(-1, Math.cos(d13) / Math.cos(xt))));
  const sign = Math.cos(b13 - b12) >= 0 ? 1 : -1;
  return { alongKm: sign * at * R, acrossKm: xt * R };
}

/**
 * A section through an event: down-dip across the nearest slab when there is one
 * within 150 km (the view that shows a Wadati-Benioff zone), otherwise east-west.
 */
export function profileFor(lat: number, lon: number, slabs: Slab[], opts: { halfLengthKm?: number; halfWidthKm?: number } = {}): Profile {
  const base = { lat, lon, halfLengthKm: opts.halfLengthKm ?? 500, halfWidthKm: opts.halfWidthKm ?? 50 };
  for (const r of [0, 50, 100, 150]) {
    for (const az of r === 0 ? [0] : [0, 45, 90, 135, 180, 225, 270, 315]) {
      const q = r === 0 ? { lat, lon } : destination(lat, lon, az, r);
      const dip = downDipAzimuth(slabs, q.lat, q.lon);
      const slab = slabDepthAt(slabs, q.lat, q.lon);
      if (dip !== null && slab) return { ...base, azimuthDeg: dip, orientation: "down-dip", slab: slab.code };
    }
  }
  return { ...base, azimuthDeg: 90, orientation: "east-west", slab: null };
}

/** Slab-top depth sampled along the section line; null where the line is off the slab. */
export function slabAlong(p: Profile, slabs: Slab[], stepKm = 10): { alongKm: number; depthKm: number | null }[] {
  const out: { alongKm: number; depthKm: number | null }[] = [];
  for (let a = -p.halfLengthKm; a <= p.halfLengthKm + 1e-9; a += stepKm) {
    const q = destination(p.lat, p.lon, a >= 0 ? p.azimuthDeg : p.azimuthDeg + 180, Math.abs(a));
    out.push({ alongKm: a, depthKm: slabDepthAt(slabs, q.lat, q.lon)?.depthKm ?? null });
  }
  return out;
}
