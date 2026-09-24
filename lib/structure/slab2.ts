/**
 * Slab2 (Hayes et al. 2018, USGS, public domain): the depth of the top of each
 * subducting slab, decimated to 0.2° by scripts/build-slab2.py. Format SLB1 is
 * documented there.
 */

export const SLAB_NAMES: Record<string, string> = {
  alu: "Aleutians", cal: "Calabria", cam: "Central America", car: "Caribbean", cas: "Cascadia", cot: "Cotabato",
  hal: "Halmahera", hel: "Hellenic", him: "Himalaya", hin: "Hindu Kush", izu: "Izu-Bonin", ker: "Kermadec-Tonga",
  kur: "Kuril-Kamchatka-Japan", mak: "Makran", man: "Manila", mue: "Muertos", pam: "Pamir", phi: "Philippines",
  png: "New Guinea", puy: "Puysegur", ryu: "Ryukyu", sam: "South America", sco: "Scotia", sol: "Solomon",
  sul: "Sulawesi", sum: "Sumatra-Java", van: "Vanuatu",
};

export interface Slab {
  code: string;
  lonMin: number; // 0..360
  latMin: number;
  step: number;
  nLon: number;
  nLat: number;
  /** Depth of the slab top in km, positive down; NaN where absent. [lat][lon] */
  depth: Float32Array;
}

export function parseSlab2(buf: ArrayBuffer): Slab[] {
  const v = new DataView(buf);
  if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== "SLB1") throw new Error("not a SLB1 file");
  const n = v.getUint32(4, true);
  let o = 8;
  const out: Slab[] = [];
  for (let s = 0; s < n; s++) {
    const code = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2)).replace(/\0/g, "");
    const lonMin = v.getFloat32(o + 4, true), latMin = v.getFloat32(o + 8, true), step = v.getFloat32(o + 12, true);
    const nLon = v.getUint32(o + 16, true), nLat = v.getUint32(o + 20, true);
    o += 24;
    const depth = new Float32Array(nLon * nLat);
    for (let i = 0; i < depth.length; i++, o += 2) {
      const d = v.getInt16(o, true);
      depth[i] = d === -32768 ? NaN : d / 10;
    }
    out.push({ code, lonMin, latMin, step, nLon, nLat, depth });
  }
  return out;
}

const lon360 = (lon: number) => ((lon % 360) + 360) % 360;

function at(s: Slab, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= s.nLon || j >= s.nLat) return NaN;
  return s.depth[j * s.nLon + i]!;
}

/** Bilinear slab-top depth in km, or null outside every slab. Where two slabs
 *  overlap (rare, at junctions), the shallower surface is returned. */
export function slabDepthAt(slabs: Slab[], lat: number, lon: number): { code: string; depthKm: number } | null {
  let best: { code: string; depthKm: number } | null = null;
  const L = lon360(lon);
  for (const s of slabs) {
    const x = (L - s.lonMin) / s.step, y = (lat - s.latMin) / s.step;
    const i = Math.floor(x), j = Math.floor(y);
    const a = at(s, i, j), b = at(s, i + 1, j), c = at(s, i, j + 1), d = at(s, i + 1, j + 1);
    if ([a, b, c, d].some(Number.isNaN)) continue;
    const tx = x - i, ty = y - j;
    const depthKm = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    if (!best || depthKm < best.depthKm) best = { code: s.code, depthKm };
  }
  return best;
}

/** Down-dip azimuth (degrees clockwise from north) at a point on a slab: the
 *  direction the slab deepens fastest. A cross-section along it cuts the slab
 *  at right angles to the trench. */
export function downDipAzimuth(slabs: Slab[], lat: number, lon: number): number | null {
  const h = 0.2;
  const n = slabDepthAt(slabs, lat + h, lon), s = slabDepthAt(slabs, lat - h, lon);
  const e = slabDepthAt(slabs, lat, lon + h), w = slabDepthAt(slabs, lat, lon - h);
  if (!n || !s || !e || !w) return null;
  const dNorth = (n.depthKm - s.depthKm) / (2 * h * 111.19);
  const dEast = (e.depthKm - w.depthKm) / (2 * h * 111.19 * Math.cos((lat * Math.PI) / 180));
  if (Math.hypot(dNorth, dEast) < 1e-6) return null;
  return ((Math.atan2(dEast, dNorth) * 180) / Math.PI + 360) % 360;
}

/** Triangles over cells with at least three valid corners. Vertices are
 *  (lat, lon, depthKm) so the caller projects them with the globe's own projection. */
export function slabMesh(s: Slab): { vertices: Float32Array; indices: Uint32Array } {
  const index = new Int32Array(s.nLon * s.nLat).fill(-1);
  const verts: number[] = [];
  for (let j = 0; j < s.nLat; j++)
    for (let i = 0; i < s.nLon; i++) {
      const d = at(s, i, j);
      if (Number.isNaN(d)) continue;
      index[j * s.nLon + i] = verts.length / 3;
      verts.push(s.latMin + j * s.step, s.lonMin + i * s.step, d);
    }
  const idx: number[] = [];
  const id = (i: number, j: number) => index[j * s.nLon + i]!;
  for (let j = 0; j < s.nLat - 1; j++)
    for (let i = 0; i < s.nLon - 1; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
      if (a >= 0 && b >= 0 && c >= 0) idx.push(a, b, c);
      else if (a >= 0 && b >= 0 && d >= 0) idx.push(a, b, d);
      if (b >= 0 && d >= 0 && c >= 0) idx.push(b, d, c);
      else if (a >= 0 && d >= 0 && c >= 0 && b < 0) idx.push(a, d, c);
    }
  return { vertices: Float32Array.from(verts), indices: Uint32Array.from(idx) };
}

let cached: Promise<Slab[]> | null = null;

export function loadSlabs(url = "/data/slab2.bin", fetchImpl: typeof fetch = fetch): Promise<Slab[]> {
  cached ??= fetchImpl(url).then(async (r) => {
    if (!r.ok) throw new Error(`slab2: HTTP ${r.status}`);
    return parseSlab2(await r.arrayBuffer());
  });
  cached.catch(() => (cached = null));
  return cached;
}
