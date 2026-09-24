import { describe, expect, it } from "vitest";
import {
  EARTH_RADIUS_KM,
  projectHypocenter,
  SCENE_RADIUS,
  unprojectDirection,
} from "./project";

const len = ([x, y, z]: [number, number, number]) => Math.hypot(x, y, z);

describe("projectHypocenter", () => {
  it("places a surface event exactly on the shell", () => {
    expect(len(projectHypocenter(0, 0, 0))).toBeCloseTo(SCENE_RADIUS, 9);
    expect(len(projectHypocenter(45, 90, 0))).toBeCloseTo(SCENE_RADIUS, 9);
  });

  it("places a null depth on the shell, not at the centre", () => {
    expect(len(projectHypocenter(10, 20, null))).toBeCloseTo(SCENE_RADIUS, 9);
  });

  it("places a deep event inside the shell, proportionally", () => {
    const r = len(projectHypocenter(0, 0, 700));
    expect(r).toBeLessThan(SCENE_RADIUS);
    expect(r).toBeCloseTo(SCENE_RADIUS * (1 - 700 / EARTH_RADIUS_KM), 9);
  });

  it("places a NEGATIVE depth OUTSIDE the shell rather than clamping it", () => {
    const r = len(projectHypocenter(0, 0, -5));
    expect(r).toBeGreaterThan(SCENE_RADIUS);
    expect(r).toBeCloseTo(SCENE_RADIUS * (1 + 5 / EARTH_RADIUS_KM), 9);
  });

  it("never places anything at or through the centre", () => {
    // Nothing is deeper than the Earth's radius, but a corrupt feed could say so.
    expect(len(projectHypocenter(0, 0, 99_999))).toBeGreaterThan(0);
    expect(len(projectHypocenter(0, 0, EARTH_RADIUS_KM))).toBeGreaterThan(0);
  });

  it("puts 0N 0E on the +X axis and the north pole on +Y", () => {
    const [x, y, z] = projectHypocenter(0, 0, 0);
    expect(x).toBeCloseTo(1, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(0, 9);
    expect(projectHypocenter(90, 0, 0)[1]).toBeCloseTo(1, 9);
  });

  it("round-trips direction through unproject", () => {
    for (const [lat, lon] of [
      [0, 0],
      [35.7, -117.6],
      [-33.9, 151.2],
      [89.9, 179.9],
    ] as [number, number][]) {
      const back = unprojectDirection(...projectHypocenter(lat, lon, 0));
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(((back.lon - lon + 540) % 360) - 180).toBeCloseTo(0, 6);
    }
  });

  it("returns finite coordinates for non-finite input rather than NaN", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(projectHypocenter(bad, 0, 0).every(Number.isFinite)).toBe(true);
      expect(projectHypocenter(0, bad, 0).every(Number.isFinite)).toBe(true);
      expect(projectHypocenter(0, 0, bad).every(Number.isFinite)).toBe(true);
    }
  });

  it("returns the origin direction for a zero vector rather than NaN", () => {
    expect(unprojectDirection(0, 0, 0)).toEqual({ lat: 0, lon: 0 });
  });
});
