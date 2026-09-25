import { describe, expect, it } from "vitest";
import { projectHypocenter } from "../geo/project";
import { children, parent, selectTiles, subRect, tileBounds } from "./tiles";

const cameraOver = (lat: number, lon: number, altitudeKm: number) => projectHypocenter(lat, lon, -altitudeKm);
const base = { fovY: (45 * Math.PI) / 180, viewportHeightPx: 900, maxLevel: 16 };

describe("the tile grid", () => {
  it("has two 180° tiles at level 0 and quarters each level", () => {
    expect(tileBounds({ z: 0, x: 0, y: 0 })).toEqual({ west: -180, east: 0, south: -90, north: 90 });
    expect(tileBounds({ z: 0, x: 1, y: 0 })).toEqual({ west: 0, east: 180, south: -90, north: 90 });
    expect(tileBounds({ z: 2, x: 7, y: 3 })).toEqual({ west: 135, east: 180, south: -90, north: -45 });
    for (const c of children({ z: 3, x: 5, y: 2 })) expect(parent(c)).toEqual({ z: 3, x: 5, y: 2 });
  });

  it("maps a descendant into its ancestor's texture", () => {
    // The north-west quarter of a tile is its top-left: u 0–0.5, v 0.5–1.
    expect(subRect({ z: 1, x: 0, y: 0 }, { z: 0, x: 0, y: 0 })).toEqual({ offset: [0, 0.5], scale: 0.5 });
    expect(subRect({ z: 2, x: 7, y: 3 }, { z: 0, x: 1, y: 0 })).toEqual({ offset: [0.75, 0], scale: 0.25 });
  });
});

describe("selectTiles", () => {
  it("shows the whole visible hemisphere at low resolution from far away", () => {
    const s = selectTiles({ ...base, camera: cameraOver(0, 0, 3 * 6371) });
    expect(s.length).toBeGreaterThan(4);
    expect(Math.max(...s.map((t) => t.key.z))).toBeLessThanOrEqual(3);
  });

  it("culls the far side of the planet", () => {
    const s = selectTiles({ ...base, camera: cameraOver(0, 0, 2 * 6371) });
    for (const t of s) {
      const b = tileBounds(t.key);
      // Nothing entirely on the far hemisphere (beyond 90° from 0,0).
      expect(b.east > -95 && b.west < 95).toBe(true);
    }
  });

  it("refines deep near the camera when close to the ground", () => {
    const s = selectTiles({ ...base, camera: cameraOver(35.68, 139.69, 5) });
    const deepest = s[0]!;
    expect(deepest.key.z).toBeGreaterThanOrEqual(11);
    const b = tileBounds(deepest.key);
    expect(35.68).toBeGreaterThanOrEqual(b.south - 0.5);
    expect(35.68).toBeLessThanOrEqual(b.north + 0.5);
  });

  it("never exceeds the level cap or the tile budget", () => {
    const s = selectTiles({ ...base, camera: cameraOver(-33.9, 151.2, 1), maxLevel: 12, maxTiles: 200 });
    expect(Math.max(...s.map((t) => t.key.z))).toBeLessThanOrEqual(12);
    expect(s.length).toBeLessThanOrEqual(200);
  });

  it("tiles the view without overlap", () => {
    const s = selectTiles({ ...base, camera: cameraOver(10, 20, 800) });
    const ids = s.map((t) => t.key);
    for (const a of ids) for (const b of ids) {
      if (a === b || a.z >= b.z) continue;
      // b must not be a descendant of a.
      const shift = b.z - a.z;
      expect(b.x >> shift === a.x && b.y >> shift === a.y).toBe(false);
    }
  });

  it("covers the antimeridian and the poles", () => {
    expect(selectTiles({ ...base, camera: cameraOver(0, 180, 3000) }).some((t) => tileBounds(t.key).east === 180)).toBe(true);
    expect(selectTiles({ ...base, camera: cameraOver(0, 180, 3000) }).some((t) => tileBounds(t.key).west === -180)).toBe(true);
    expect(selectTiles({ ...base, camera: cameraOver(89, 0, 3000) }).some((t) => tileBounds(t.key).north === 90)).toBe(true);
  });
});
