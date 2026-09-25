import { projectHypocenter } from "./project";

const DEG = Math.PI / 180;

/**
 * The subsolar point: where the Sun is overhead at `timeMs`. The Astronomical
 * Almanac's low-precision solar coordinates (good to about 0.01° over
 * 1950–2050), with Greenwich mean sidereal time for longitude. Enough to put the
 * day/night terminator in the right place to within a few kilometres.
 */
export function subsolarPoint(timeMs: number): { lat: number; lon: number } {
  const n = timeMs / 86_400_000 + 2440587.5 - 2451545.0; // days since J2000.0
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstDeg = 280.46061837 + 360.98564736629 * n;
  const lon = ((((ra / DEG - gmstDeg) % 360) + 540) % 360) - 180;
  return { lat: dec / DEG, lon };
}

/** Unit vector toward the Sun in scene coordinates. */
export function sunDirection(timeMs: number): [number, number, number] {
  const s = subsolarPoint(timeMs);
  return projectHypocenter(s.lat, s.lon, 0);
}
