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
