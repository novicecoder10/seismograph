import { describe, expect, it } from "vitest";
import { subsolarPoint, sunDirection } from "./sun";

describe("subsolarPoint", () => {
  it("sits on the Tropic of Cancer at the June solstice and the Tropic of Capricorn in December", () => {
    expect(subsolarPoint(Date.UTC(2026, 5, 21, 8, 24)).lat).toBeCloseTo(23.44, 1);
    expect(subsolarPoint(Date.UTC(2026, 11, 21, 20, 50)).lat).toBeCloseTo(-23.44, 1);
  });

  it("crosses the equator at the March equinox", () => {
    expect(Math.abs(subsolarPoint(Date.UTC(2026, 2, 20, 14, 46)).lat)).toBeLessThan(0.02);
  });

  it("is near the Greenwich meridian at noon UTC, offset by the equation of time", () => {
    // Early November the Sun runs ~16 minutes fast: solar noon at Greenwich is
    // 11:44 UTC, so by 12:00 the subsolar point has moved ≈ 4° west.
    expect(subsolarPoint(Date.UTC(2026, 10, 3, 12)).lon).toBeCloseTo(-4.1, 0);
    // Mid-February it runs ~14 minutes slow: still ≈ 3.5° east of Greenwich.
    expect(subsolarPoint(Date.UTC(2026, 1, 11, 12)).lon).toBeCloseTo(3.6, 0);
  });

  it("moves west 15° per hour", () => {
    const a = subsolarPoint(Date.UTC(2026, 8, 25, 0)).lon;
    const b = subsolarPoint(Date.UTC(2026, 8, 25, 1)).lon;
    expect(((a - b + 540) % 360) - 180).toBeCloseTo(15, 1);
  });

  it("gives a unit direction", () => {
    expect(Math.hypot(...sunDirection(Date.now()))).toBeCloseTo(1, 9);
  });
});
