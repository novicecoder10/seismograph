import { describe, expect, it } from "vitest";
import { greatCircleKm } from "../science/distance";
import { bboxAround, bboxContains, crossesAntimeridian, splitAntimeridian } from "./bbox";

describe("crossesAntimeridian", () => {
  it("is true when west is greater than east", () => {
    expect(crossesAntimeridian({ west: 170, east: -170, south: 0, north: 10 })).toBe(true);
  });
  it("is false for an ordinary box", () => {
    expect(crossesAntimeridian({ west: -120, east: -110, south: 30, north: 40 })).toBe(false);
  });
});

describe("bboxContains", () => {
  const pacific = { west: 170, east: -170, south: -10, north: 10 };

  it("contains points on both sides of the date line", () => {
    expect(bboxContains(pacific, 0, 175)).toBe(true);
    expect(bboxContains(pacific, 0, -175)).toBe(true);
    expect(bboxContains(pacific, 0, 180)).toBe(true);
    expect(bboxContains(pacific, 0, -180)).toBe(true);
  });

  it("excludes the 340 degrees the box does NOT cover", () => {
    expect(bboxContains(pacific, 0, 0)).toBe(false);
    expect(bboxContains(pacific, 0, 100)).toBe(false);
    expect(bboxContains(pacific, 0, -100)).toBe(false);
  });

  it("respects latitude bounds independently", () => {
    expect(bboxContains(pacific, 11, 175)).toBe(false);
    expect(bboxContains(pacific, -11, 175)).toBe(false);
  });

  it("handles a polar box", () => {
    const polar = { west: -180, east: 180, south: 80, north: 90 };
    expect(bboxContains(polar, 85, 0)).toBe(true);
    expect(bboxContains(polar, 85, 179)).toBe(true);
    expect(bboxContains(polar, 79, 0)).toBe(false);
  });
});

describe("splitAntimeridian", () => {
  it("splits a crossing box into two FDSN-safe boxes", () => {
    const parts = splitAntimeridian({ west: 170, east: -170, south: -10, north: 10 });
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ west: 170, east: 180, south: -10, north: 10 });
    expect(parts[1]).toEqual({ west: -180, east: -170, south: -10, north: 10 });
  });

  it("returns a single box unchanged when it does not cross", () => {
    const box = { west: -120, east: -110, south: 30, north: 40 };
    expect(splitAntimeridian(box)).toEqual([box]);
  });
});

describe("bboxAround", () => {
  it("contains every point within the radius", () => {
    const box = bboxAround(35, -117, 100);
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const rad = (bearing * Math.PI) / 180;
      const lat = 35 + (95 / 111.19) * Math.cos(rad);
      const lon = -117 + (95 / (111.19 * Math.cos((35 * Math.PI) / 180))) * Math.sin(rad);
      expect(greatCircleKm(35, -117, lat, lon)).toBeLessThan(100);
      expect(bboxContains(box, lat, lon)).toBe(true);
    }
  });

  it("wraps across the antimeridian", () => {
    const box = bboxAround(0, 179.5, 200);
    expect(box.west).toBeGreaterThan(box.east);
    expect(bboxContains(box, 0, -179.5)).toBe(true);
  });

  it("spans every longitude when the circle reaches a pole", () => {
    const box = bboxAround(89, 0, 300);
    expect(box.west).toBe(-180);
    expect(box.east).toBe(180);
    expect(box.north).toBe(90);
  });
});
