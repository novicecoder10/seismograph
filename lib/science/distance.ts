const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

/** Great-circle distance. On a sphere this is what "nearest" has to mean: a
 *  degree of longitude is 111 km at the equator and 0 at the pole, so a degree
 *  box is wrong at 179°E and catastrophically wrong at 85°N. */
export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface Located {
  lat: number;
  lon: number;
  depthKm: number | null;
}

/** Hypocentral separation. An unknown depth is treated as the OTHER event's
 *  depth rather than as zero: assuming the surface would drag every
 *  unconstrained event hundreds of kilometres from a deep neighbour it may
 *  actually be co-located with. */
export function hypocentralKm(a: Located, b: Located): number {
  const epicentral = greatCircleKm(a.lat, a.lon, b.lat, b.lon);
  const da = a.depthKm;
  const db = b.depthKm;
  if (da === null && db === null) return epicentral;
  const depthDiff = da === null || db === null ? 0 : da - db;
  return Math.hypot(epicentral, depthDiff);
}
