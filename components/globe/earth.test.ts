import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { projectHypocenter } from "@/lib/geo/project";
import { tileBounds } from "@/lib/globe/tiles";
import { makeTileGeometry, type HeightSampler } from "./earth";

const KM = 6371;
// Rugged, non-planar relief: kilometres of it.
const relief = (lat: number, lon: number) => 2500 + 2000 * Math.sin(lat * 7.1) * Math.cos(lon * 5.3) + 600 * Math.sin(lat * 31 + lon * 17);
const sampler: HeightSampler = { inner: relief, edge: relief };

/** World positions of the main grid (skirts excluded) as rows south→north. */
function grid(k: { z: number; x: number; y: number }) {
  const { geometry, center } = makeTileGeometry(k, sampler);
  const pos = geometry.getAttribute("position");
  const nVerts = Math.round(Math.sqrt(geometry.getAttribute("aSkirt").array.filter((v: number) => v === 0).length));
  const at = (i: number, j: number) => new THREE.Vector3().fromBufferAttribute(pos, j * nVerts + i).add(center);
  return { at, segs: nVerts - 1 };
}

/** Distance from p to the polyline through pts, in km. */
function toPolyline(p: THREE.Vector3, pts: THREE.Vector3[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const ab = b.clone().sub(a);
    const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
    best = Math.min(best, a.clone().addScaledVector(ab, t).distanceTo(p));
  }
  return best * KM;
}

describe("terrain tiles", () => {
  it("raise the ground to the height they are given", () => {
    const k = { z: 10, x: 1500, y: 350 };
    const { at, segs } = grid(k);
    const b = tileBounds(k);
    const mid = Math.floor(segs / 2);
    const lat = b.south + ((b.north - b.south) * mid) / segs, lon = b.west + ((b.east - b.west) * mid) / segs;
    const want = new THREE.Vector3(...projectHypocenter(lat, lon, -relief(lat, lon) / 1000));
    expect(at(mid, mid).distanceTo(want) * KM).toBeLessThan(0.001);
  });

  it("keep a T-junction with a coarser neighbour within metres, well inside the skirt", () => {
    // A (level 10) and B (level 11) share A's east edge; B covers its lower half.
    const A = { z: 10, x: 1500, y: 350 };
    const B = { z: 11, x: 3002, y: 701 };
    expect(tileBounds(B).west).toBeCloseTo(tileBounds(A).east, 9);
    const a = grid(A), b = grid(B);
    const coarseEdge = Array.from({ length: a.segs + 1 }, (_, j) => a.at(a.segs, j));
    let worst = 0;
    for (let j = 0; j <= b.segs; j++) worst = Math.max(worst, toPolyline(b.at(0, j), coarseEdge));
    // Kilometres of rugged relief leave a few metres between the coarse edge's
    // vertices; the skirt beneath hangs at least 200 m.
    expect(worst).toBeLessThan(0.006);
  });

  it("match a same-level neighbour exactly", () => {
    const A = { z: 11, x: 3000, y: 700 }, B = { z: 11, x: 3001, y: 700 };
    const a = grid(A), b = grid(B);
    for (let j = 0; j <= a.segs; j++) expect(a.at(a.segs, j).distanceTo(b.at(0, j)) * KM).toBeLessThan(1e-4);
  });
});
