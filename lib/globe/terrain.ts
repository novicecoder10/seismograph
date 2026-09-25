import type { TileBounds } from "./tiles";

/**
 * Elevation from AWS Terrain Tiles (Mapzen's "terrarium" encoding, open data):
 * 256 px PNGs in the Web Mercator grid, zooms 0–15, height in metres
 * = R·256 + G + B/256 − 32768. The imagery quadtree is geographic, so each
 * imagery tile samples whichever Mercator tiles cover it.
 */
export const TERRAIN_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const TERRAIN_MAX_ZOOM = 15;
export const TERRAIN_PX = 256;
/** Web Mercator stops here; beyond it the ground is drawn flat. */
export const MERCATOR_MAX_LAT = 85.0511;

export type Heights = Float32Array;

export function decodeTerrarium(rgba: ArrayLike<number>): Heights {
  const n = rgba.length / 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rgba[i * 4]! * 256 + rgba[i * 4 + 1]! + rgba[i * 4 + 2]! / 256 - 32768;
  return out;
}

/** Fractional Mercator tile coordinates of a point at zoom z. */
export function mercatorTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const la = (Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n,
  };
}

/** The Mercator tiles at zoom z that a geographic box touches. */
export function tilesCovering(b: TileBounds, z: number): { z: number; x: number; y: number }[] {
  const n = 2 ** z;
  const nw = mercatorTile(Math.min(b.north, MERCATOR_MAX_LAT), b.west, z);
  const se = mercatorTile(Math.max(b.south, -MERCATOR_MAX_LAT), b.east, z);
  if (b.south >= MERCATOR_MAX_LAT || b.north <= -MERCATOR_MAX_LAT) return [];
  const out: { z: number; x: number; y: number }[] = [];
  const x0 = Math.floor(nw.x), x1 = Math.min(n - 1, Math.ceil(se.x) - 1);
  const y0 = Math.max(0, Math.floor(nw.y)), y1 = Math.min(n - 1, Math.ceil(se.y) - 1);
  for (let y = y0; y <= y1; y++) for (let x = Math.max(0, x0); x <= Math.max(x0, x1); x++) out.push({ z, x, y });
  return out;
}

/** The Mercator zoom whose pixels match a geographic tile of level z with `segs` segments. */
export function terrainZoomFor(level: number): number {
  return Math.min(TERRAIN_MAX_ZOOM, Math.max(0, level));
}

/**
 * Height at a point from the best cached Mercator tile at or below `maxZoom`,
 * bilinearly. `get` returns a decoded tile or undefined. Null when nothing
 * covering the point is cached.
 */
export function sampleHeight(get: (z: number, x: number, y: number) => Heights | undefined, lat: number, lon: number, maxZoom: number): { h: number; zoom: number } | null {
  if (Math.abs(lat) >= MERCATOR_MAX_LAT) return { h: 0, zoom: maxZoom };
  for (let z = maxZoom; z >= 0; z--) {
    const t = mercatorTile(lat, lon, z);
    const n = 2 ** z;
    const tx = Math.min(n - 1, Math.floor(t.x)), ty = Math.min(n - 1, Math.floor(t.y));
    const h = get(z, tx, ty);
    if (!h) continue;
    // Pixel centres: the last row/column clamps rather than reading a neighbour.
    const px = Math.min(TERRAIN_PX - 1, Math.max(0, (t.x - tx) * TERRAIN_PX - 0.5));
    const py = Math.min(TERRAIN_PX - 1, Math.max(0, (t.y - ty) * TERRAIN_PX - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const x1 = Math.min(TERRAIN_PX - 1, x0 + 1), y1 = Math.min(TERRAIN_PX - 1, y0 + 1);
    const fx = px - x0, fy = py - y0;
    const at = (x: number, y: number) => h[y * TERRAIN_PX + x]!;
    const v = (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
    return { h: v, zoom: z };
  }
  return null;
}
