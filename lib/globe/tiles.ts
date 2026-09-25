import { projectHypocenter } from "../geo/project";

/**
 * The imagery quadtree. Both imagery services use the same geographic grid:
 * level z is 2^(z+1) columns by 2^z rows of 180/2^z-degree tiles, row 0 at the
 * north pole, column 0 at 180°W. Selection is pure so it can be tested without
 * a GPU.
 */
export interface TileKey {
  z: number;
  x: number;
  y: number;
}

export interface TileBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export const tileId = (k: TileKey) => `${k.z}/${k.y}/${k.x}`;

export function tileBounds(k: TileKey): TileBounds {
  const span = 180 / 2 ** k.z;
  const west = -180 + k.x * span;
  const north = 90 - k.y * span;
  return { west, east: west + span, south: north - span, north };
}

export function parent(k: TileKey): TileKey | null {
  return k.z === 0 ? null : { z: k.z - 1, x: k.x >> 1, y: k.y >> 1 };
}

export function children(k: TileKey): TileKey[] {
  const z = k.z + 1, x = k.x * 2, y = k.y * 2;
  return [{ z, x, y }, { z, x: x + 1, y }, { z, x, y: y + 1 }, { z, x: x + 1, y: y + 1 }];
}

/** The part of `outer` that `inner` covers, as a UV offset and scale. */
export function subRect(inner: TileKey, outer: TileKey): { offset: [number, number]; scale: number } {
  const levels = inner.z - outer.z;
  const scale = 1 / 2 ** levels;
  const fx = inner.x - (outer.x << levels);
  const fy = inner.y - (outer.y << levels);
  // UV v runs south to north, rows run north to south.
  return { offset: [fx * scale, 1 - (fy + 1) * scale], scale };
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const DEG = Math.PI / 180;
/** The highest ground on Earth plus margin, in Earth radii. */
const TERRAIN_PAD = 9.5 / 6371;

/** The point of the tile nearest the camera's nadir: the tile's best chance of being seen. */
function nearestPoint(b: TileBounds, nadir: { lat: number; lon: number }): V3 {
  const lat = Math.min(b.north, Math.max(b.south, nadir.lat));
  // Longitude clamps on the circle: pick the nearer edge when outside.
  let lon = nadir.lon;
  if (lon < b.west || lon > b.east) {
    const dw = Math.abs(((nadir.lon - b.west + 540) % 360) - 180);
    const de = Math.abs(((nadir.lon - b.east + 540) % 360) - 180);
    lon = dw < de ? b.west : b.east;
  }
  return projectHypocenter(lat, lon, 0);
}

export interface SelectOptions {
  camera: V3;
  /** Vertical field of view, radians. */
  fovY: number;
  viewportHeightPx: number;
  maxLevel: number;
  tilePx?: number;
  /** Refine while one texel covers more than this many screen pixels. */
  maxTexelPx?: number;
  maxTiles?: number;
  /** Frustum test on a bounding sphere; everything passes when omitted. */
  inFrustum?(center: V3, radius: number): boolean;
}

export interface Selected {
  key: TileKey;
  distance: number;
}

export function selectTiles(o: SelectOptions): Selected[] {
  const tilePx = o.tilePx ?? 256;
  const maxTexelPx = o.maxTexelPx ?? 1.25;
  const maxTiles = o.maxTiles ?? 320;
  const C = o.camera;
  const cr = Math.hypot(...C);
  const nadir = { lat: Math.asin(C[1] / cr) / DEG, lon: Math.atan2(-C[2], C[0]) / DEG };
  const pxPerRadianAtUnit = o.viewportHeightPx / (2 * Math.tan(o.fovY / 2));

  // Nearest first, so when the budget runs out it is the horizon that stays
  // coarse, never the ground under the camera.
  const out: Selected[] = [];
  const queue: Selected[] = [];
  const consider = (k: TileKey) => {
    const b = tileBounds(k);
    const p = nearestPoint(b, nadir);
    // Horizon culling: a point p on the unit sphere is visible from C iff p·C > 1.
    // The margin keeps tiles straddling the horizon.
    if (dot(p, C) < 1 - 1e-3 - 2 * TERRAIN_PAD * Math.hypot(...C)) return;
    if (o.inFrustum && k.z > 1) {
      const c = projectHypocenter((b.north + b.south) / 2, (b.east + b.west) / 2, 0);
      // Padded by the highest terrain (Everest, 8.8 km): raised ground reaches
      // into the view from a tile whose sea-level sphere is just outside it.
      const radius = (Math.max(b.north - b.south, (b.east - b.west) * Math.cos(Math.min(Math.abs(b.north), Math.abs(b.south)) * DEG)) * DEG) * 0.75 + TERRAIN_PAD;
      if (!o.inFrustum(c, radius)) return;
    }
    const distance = Math.max(1e-6, Math.hypot(C[0] - p[0], C[1] - p[1], C[2] - p[2]));
    let i = queue.length;
    while (i > 0 && queue[i - 1]!.distance > distance) i--;
    queue.splice(i, 0, { key: k, distance });
  };
  consider({ z: 0, x: 0, y: 0 });
  consider({ z: 0, x: 1, y: 0 });
  while (queue.length > 0) {
    const t = queue.shift()!;
    const b = tileBounds(t.key);
    const texel = ((b.north - b.south) * DEG) / tilePx;
    const texelPx = (texel / t.distance) * pxPerRadianAtUnit;
    if (texelPx > maxTexelPx && t.key.z < o.maxLevel && out.length + queue.length + 4 <= maxTiles) {
      for (const c of children(t.key)) consider(c);
    } else {
      out.push(t);
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}
