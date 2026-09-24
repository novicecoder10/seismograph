export const EARTH_RADIUS_KM = 6371;
export const SCENE_RADIUS = 1;

const DEG = Math.PI / 180;

/** Nothing renders closer to the centre than this. A corrupt depth must not
 *  collapse an event onto the origin, where it would be unpickable and would
 *  sit behind every other point. */
const MIN_RADIUS = SCENE_RADIUS * 0.02;

/**
 * Scene coordinates for a hypocenter. Depth is measured downward from the
 * surface, so a NEGATIVE depth is above sea level and lies OUTSIDE the shell —
 * USGS reports such events and clamping them would silently move them.
 */
export function projectHypocenter(
  latDeg: number,
  lonDeg: number,
  depthKm: number | null,
): [number, number, number] {
  const lat = (Number.isFinite(latDeg) ? latDeg : 0) * DEG;
  const lon = (Number.isFinite(lonDeg) ? lonDeg : 0) * DEG;
  const depth = depthKm !== null && Number.isFinite(depthKm) ? depthKm : 0;

  const r = Math.max(MIN_RADIUS, SCENE_RADIUS * (1 - depth / EARTH_RADIUS_KM));

  return [
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    r * Math.cos(lat) * Math.sin(lon),
  ];
}

export function unprojectDirection(
  x: number,
  y: number,
  z: number,
): { lat: number; lon: number } {
  const r = Math.hypot(x, y, z);
  if (r === 0) return { lat: 0, lon: 0 };
  return { lat: Math.asin(y / r) / DEG, lon: Math.atan2(z, x) / DEG };
}
