import { describe, expect, it } from "vitest";
import { bboxContains, crossesAntimeridian, splitAntimeridian } from "./bbox";

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
