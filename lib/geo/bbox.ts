import type { BBox } from "../events/types";

/** A box whose west bound exceeds its east bound wraps the date line. A filter
 *  of 170 to -170 is a 20 degree window across the antimeridian, not a 340
 *  degree window the other way round. */
export function crossesAntimeridian(b: BBox): boolean {
  return b.west > b.east;
}

export function bboxContains(b: BBox, lat: number, lon: number): boolean {
  if (lat < b.south || lat > b.north) return false;
  return crossesAntimeridian(b)
    ? lon >= b.west || lon <= b.east
    : lon >= b.west && lon <= b.east;
}

/** FDSN rejects a west bound greater than its east bound, so a crossing box
 *  becomes two queries whose results are concatenated. */
export function splitAntimeridian(b: BBox): BBox[] {
  if (!crossesAntimeridian(b)) return [b];
  return [
    { west: b.west, east: 180, south: b.south, north: b.north },
    { west: -180, east: b.east, south: b.south, north: b.north },
  ];
}

const KM_PER_DEG = 111.19;

/** The smallest lat/lon box containing a circle of `radiusKm`. Wraps across the
 *  antimeridian, and opens to all longitudes when the circle reaches a pole —
 *  where a longitude span stops meaning anything. */
export function bboxAround(lat: number, lon: number, radiusKm: number): BBox {
  const dLat = radiusKm / KM_PER_DEG;
  const south = Math.max(-90, lat - dLat);
  const north = Math.min(90, lat + dLat);
  if (north >= 89.999 || south <= -89.999) {
    return { west: -180, east: 180, south, north: north >= 89.999 ? 90 : north };
  }
  const maxAbsLat = Math.max(Math.abs(south), Math.abs(north));
  const dLon = radiusKm / (KM_PER_DEG * Math.cos((maxAbsLat * Math.PI) / 180));
  if (dLon >= 180) return { west: -180, east: 180, south, north };
  const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
  return { west: wrap(lon - dLon), east: wrap(lon + dLon), south, north };
}
