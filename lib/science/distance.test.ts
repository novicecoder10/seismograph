import { describe, expect, it } from "vitest";
import { greatCircleKm, hypocentralKm } from "./distance";

describe("greatCircleKm", () => {
  it("is zero for a point against itself", () => {
    expect(greatCircleKm(35.7, -117.6, 35.7, -117.6)).toBeCloseTo(0, 6);
  });
  it("gives about 111.19 km per degree of latitude", () => {
    expect(greatCircleKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });
  it("knows a degree of longitude shrinks toward the pole", () => {
    expect(greatCircleKm(60, 0, 60, 1)).toBeLessThan(greatCircleKm(0, 0, 0, 1) * 0.55);
  });
  it("measures across the antimeridian by the short way", () => {
    expect(greatCircleKm(0, 179.5, 0, -179.5)).toBeLessThan(120);
  });
  it("measures across the pole by the short way", () => {
    // Two points at 89.5N, 180 degrees apart, are ~111 km apart over the pole.
    expect(greatCircleKm(89.5, 0, 89.5, 180)).toBeCloseTo(111.19, 0);
  });
});

describe("hypocentralKm", () => {
  it("includes the depth difference", () => {
    const a = { lat: 0, lon: 0, depthKm: 0 };
    const b = { lat: 0, lon: 0, depthKm: 100 };
    expect(hypocentralKm(a, b)).toBeCloseTo(100, 6);
  });
  it("combines epicentral and depth separation in quadrature", () => {
    const a = { lat: 0, lon: 0, depthKm: 0 };
    const b = { lat: 0, lon: 1, depthKm: 111.19 };
    expect(hypocentralKm(a, b)).toBeCloseTo(Math.hypot(111.19, 111.19), 0);
  });
  it("treats an unknown depth as the other event's depth, not as zero", () => {
    // Otherwise every null-depth event is dragged to the surface and appears
    // hundreds of km from a deep neighbour it may be co-located with.
    const a = { lat: 0, lon: 0, depthKm: null };
    const b = { lat: 0, lon: 0, depthKm: 300 };
    expect(hypocentralKm(a, b)).toBeCloseTo(0, 6);
  });
  it("is zero when both depths are unknown and the epicentres coincide", () => {
    expect(
      hypocentralKm({ lat: 5, lon: 5, depthKm: null }, { lat: 5, lon: 5, depthKm: null }),
    ).toBeCloseTo(0, 6);
  });
});
