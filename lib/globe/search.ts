import { EARTH_KM } from "./camera";

/** "35.68, 139.69", "35.68 139.69", "35.68N 139.69E", "-33.9,151.2". */
export function parseCoordinates(q: string): { lat: number; lon: number } | null {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lon = -Math.abs(lon);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat, lon };
}

export interface PlaceResult {
  name: string;
  lat: number;
  lon: number;
  /** Camera altitude that frames the place. */
  altitude: number;
}

/** An eye altitude that frames a bounding box [south, north, west, east] in degrees. */
export function altitudeFor(box: [number, number, number, number] | null): number {
  if (box === null) return 1 + 40 / EARTH_KM;
  const [s, n, w, e] = box;
  const spanDeg = Math.max(n - s, Math.abs(e - w) * Math.cos((((s + n) / 2) * Math.PI) / 180));
  const km = spanDeg * 111.2 * 1.8;
  return 1 + Math.min(12000, Math.max(3, km)) / EARTH_KM;
}

/** Nominatim's jsonv2 search results, validated. */
export function parseNominatim(json: unknown): PlaceResult[] {
  if (!Array.isArray(json)) return [];
  const out: PlaceResult[] = [];
  for (const r of json) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const lat = Number(o.lat), lon = Number(o.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof o.display_name !== "string") continue;
    const bb = Array.isArray(o.boundingbox) && o.boundingbox.length === 4 ? (o.boundingbox.map(Number) as [number, number, number, number]) : null;
    out.push({ name: o.display_name, lat, lon, altitude: altitudeFor(bb && bb.every(Number.isFinite) ? bb : null) });
  }
  return out;
}
