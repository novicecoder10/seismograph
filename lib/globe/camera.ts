import { projectHypocenter, unprojectDirection } from "../geo/project";

/**
 * The Google Earth camera. The camera looks at a TARGET on the surface from
 * RANGE above it (altitude = 1 + range, in Earth radii, when looking straight
 * down), turned to HEADING (degrees clockwise from north) and tipped by TILT
 * (0 = straight down). The pre-Phase-9 orbit camera is the tilt = 0,
 * heading = 0 case, so old shared links still open where they did.
 */
export interface CameraState {
  lon: number;
  lat: number;
  altitude: number;
  heading: number;
  tilt: number;
}

export type V3 = [number, number, number];

export const EARTH_KM = 6371;
/** 1.5 km above the ground: close enough to read a town, far enough that imagery is sharp. */
export const MIN_ALTITUDE = 1 + 1.5 / EARTH_KM;
export const MAX_ALTITUDE = 50;
export const DEFAULT_CAMERA: CameraState = { lon: 150, lat: 10, altitude: 3.2, heading: 0, tilt: 0 };

/**
 * The first view of a visit: the lit side of the planet, with the evening
 * terminator in view on the right, where the city lights come on. A planet
 * that opens on its night side reads as a dark ball.
 */
export function welcomeCamera(subsolarLon: number): CameraState {
  return { ...DEFAULT_CAMERA, lon: ((subsolarLon + 55 + 540) % 360) - 180, lat: 15 };
}

const DEG = Math.PI / 180;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));

/** Up, north and east at a surface point, in scene axes. */
export function localFrame(lat: number, lon: number): { up: V3; north: V3; east: V3 } {
  const la = lat * DEG, lo = lon * DEG;
  return {
    up: [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)],
    north: [-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)],
    east: [-Math.sin(lo), 0, -Math.cos(lo)],
  };
}

/** Tilt is a close-range view: from orbit it would only aim the camera off the planet. */
export function maxTilt(altitude: number): number {
  const range = altitude - 1;
  if (range <= 0.003) return 75;
  if (range >= 0.6) return 0;
  const f = Math.log(range / 0.003) / Math.log(0.6 / 0.003);
  return 75 * (1 - f);
}

export function clampState(s: CameraState): CameraState {
  const altitude = Math.min(MAX_ALTITUDE, Math.max(MIN_ALTITUDE, Number.isFinite(s.altitude) ? s.altitude : DEFAULT_CAMERA.altitude));
  return {
    lon: ((((Number.isFinite(s.lon) ? s.lon : 0) + 180) % 360) + 360) % 360 - 180,
    lat: Math.min(89.9, Math.max(-89.9, Number.isFinite(s.lat) ? s.lat : 0)),
    altitude,
    heading: ((((Number.isFinite(s.heading) ? s.heading : 0) % 360) + 360) % 360),
    tilt: Math.min(maxTilt(altitude), Math.max(0, Number.isFinite(s.tilt) ? s.tilt : 0)),
  };
}

export interface Pose {
  position: V3;
  target: V3;
  up: V3;
}

export function cameraPose(s: CameraState): Pose {
  const f = localFrame(s.lat, s.lon);
  const h = s.heading * DEG, t = s.tilt * DEG;
  const forward = add(scale(f.north, Math.cos(h)), scale(f.east, Math.sin(h)));
  const range = s.altitude - 1;
  const back = add(scale(f.up, Math.cos(t)), scale(forward, -Math.sin(t)));
  return {
    position: add(f.up, scale(back, range)),
    target: f.up,
    up: add(scale(forward, Math.cos(t)), scale(f.up, Math.sin(t))),
  };
}

/** First intersection of a ray with the unit sphere, or null. */
export function raySphere(origin: V3, dir: V3): V3 | null {
  const d = norm(dir);
  const b = dot(origin, d);
  const c = dot(origin, origin) - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const tHit = -b - Math.sqrt(disc);
  if (tHit < 0) return null;
  return add(origin, scale(d, tHit));
}

/**
 * The grab gesture: turns the planet so the ground point `from` moves to where
 * `to` is. Longitude turns about the pole and latitude about the east axis, the
 * way Google Earth and Cesium do it, so north stays where it was. The shortest
 * rotation would be exact for the grabbed point but twists the view through
 * meridian convergence on every drag.
 */
export function rotateBy(s: CameraState, from: V3, to: V3): CameraState {
  const a = unprojectDirection(...from), b = unprojectDirection(...to);
  const dLon = ((a.lon - b.lon + 540) % 360) - 180;
  return clampState({ ...s, lat: s.lat + (a.lat - b.lat), lon: s.lon + dLon });
}

/** The surface point straight below a lat/lon, for callers that think in degrees. */
export const surface = (lat: number, lon: number): V3 => projectHypocenter(lat, lon, 0);

/**
 * Great-circle interpolation for fly-to, with a hop: when the two ends are far
 * apart the camera rises mid-flight so the planet stays in view.
 */
export function flyPath(a: CameraState, b: CameraState, u: number): CameraState {
  const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2; // ease in-out
  const p = surface(a.lat, a.lon), q = surface(b.lat, b.lon);
  const omega = Math.acos(Math.min(1, Math.max(-1, dot(p, q))));
  let point: V3;
  if (omega < 1e-9) point = p;
  else {
    const s0 = Math.sin((1 - e) * omega) / Math.sin(omega), s1 = Math.sin(e * omega) / Math.sin(omega);
    point = add(scale(p, s0), scale(q, s1));
  }
  const ll = unprojectDirection(...point);
  // Range interpolates in log space (zooming feels linear), plus a hop that
  // grows with the distance flown and peaks mid-flight.
  const hop = Math.min(2.2, omega * 1.4) * Math.sin(Math.PI * e);
  const logRange = Math.log(a.altitude - 1) * (1 - e) + Math.log(b.altitude - 1) * e;
  const altitude = 1 + Math.exp(logRange) + hop;
  const dh = ((b.heading - a.heading + 540) % 360) - 180;
  return clampState({ lat: ll.lat, lon: ll.lon, altitude, heading: a.heading + dh * e, tilt: a.tilt + (b.tilt - a.tilt) * e });
}
