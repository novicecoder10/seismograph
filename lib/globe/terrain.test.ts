import { describe, expect, it } from "vitest";
import { decodeTerrarium, mercatorTile, sampleHeight, tilesCovering, TERRAIN_PX } from "./terrain";

const pixel = (m: number) => {
  const v = m + 32768;
  return [Math.floor(v / 256), Math.floor(v % 256), Math.round((v % 1) * 256), 255];
};

describe("terrarium", () => {
  it("decodes heights, including below sea level", () => {
    const h = decodeTerrarium([...pixel(8848), ...pixel(-10994), ...pixel(0), ...pixel(12.5)]);
    expect(Array.from(h)).toEqual([8848, -10994, 0, 12.5]);
  });

  it("finds the right Mercator tile", () => {
    // Everest at zoom 10: x = (86.925 + 180) / 360 · 1024 = 759.3; y = 428.9.
    const t = mercatorTile(27.9881, 86.925, 10);
    expect(Math.floor(t.x)).toBe(759);
    expect(Math.floor(t.y)).toBe(429);
    expect(mercatorTile(0, 0, 1)).toEqual({ x: 1, y: 1 });
  });

  it("lists the tiles under a geographic box, and none beyond Mercator's latitude limit", () => {
    expect(tilesCovering({ west: 0, east: 90, south: 0, north: 45 }, 2)).toEqual([{ z: 2, x: 2, y: 1 }]);
    expect(tilesCovering({ west: -180, east: 180, south: -90, north: 90 }, 1)).toHaveLength(4);
    expect(tilesCovering({ west: 0, east: 10, south: 86, north: 90 }, 3)).toEqual([]);
  });

  it("samples the best cached zoom, bilinearly, and says which", () => {
    const flat = new Float32Array(TERRAIN_PX * TERRAIN_PX).fill(100);
    const ramp = new Float32Array(TERRAIN_PX * TERRAIN_PX).map((_, i) => i % TERRAIN_PX);
    const cache = new Map([["0/0/0", flat], ["1/1/0", ramp]]);
    const get = (z: number, x: number, y: number) => cache.get(`${z}/${x}/${y}`);
    // North-east quadrant has a zoom-1 tile: a ramp in x.
    const ne = sampleHeight(get, 40, 90, 5)!;
    expect(ne.zoom).toBe(1);
    expect(ne.h).toBeCloseTo(127.5, 0);
    // South-west only has zoom 0.
    expect(sampleHeight(get, -40, -90, 5)).toEqual({ h: 100, zoom: 0 });
    expect(sampleHeight(() => undefined, 10, 10, 5)).toBeNull();
  });
});
