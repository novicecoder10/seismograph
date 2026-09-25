import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { featuresAt, rankSimilar, whatHappenedNext, type LibrarySequence } from "./features";

const lib: LibrarySequence[] = JSON.parse(readFileSync("data/sequences/library.json", "utf8")).sequences;
const by = (name: string) => lib.find((s) => s.name === name)!;

describe("sequence features", () => {
  it("counts only aftershocks inside the elapsed window", () => {
    const f = featuresAt(7, [[-2, 5, 10], [0.5, 5.5, 10], [1.5, 6, 10], [3, 5, 10]], 2);
    expect(f.count).toBe(2);
    expect(f.largest).toBe(6);
    expect(f.bathGap).toBeCloseTo(1, 12);
    expect(f.foreshocks).toBe(1);
  });

  it("productivity normalises mainshock size: 10x the count at one magnitude larger is the same", () => {
    const small = featuresAt(6, Array.from({ length: 10 }, (_, i) => [0.1 + i * 0.1, 4.6, 10] as [number, number, number]), 2);
    const big = featuresAt(7, Array.from({ length: 100 }, (_, i) => [0.01 + i * 0.01, 4.6, 10] as [number, number, number]), 2);
    expect(big.productivity - small.productivity).toBeCloseTo(0, 1);
  });

  it("finds the larger earthquakes that followed known foreshocks", () => {
    for (const name of ["Ridgecrest foreshock", "Kumamoto foreshock", "Tohoku foreshock"]) {
      const s = by(name);
      const next = whatHappenedNext(s.mag, s.events, 0.25);
      expect(next.largerFollowed, name).toBe(true);
    }
    const rc = by("Ridgecrest foreshock");
    const n = whatHappenedNext(rc.mag, rc.events, 0.25);
    expect(n.largest!.mag).toBeCloseTo(7.1, 1);
    expect(n.largest!.days).toBeGreaterThan(1.3);
    expect(n.largest!.days).toBeLessThan(1.5);
    expect(whatHappenedNext(by("Ridgecrest").mag, by("Ridgecrest").events, 1).largerFollowed).toBe(false);
  });
});

describe("similarity", () => {
  it("ranks every other library sequence and excludes the target", () => {
    const t = by("Kaikoura");
    const ranked = rankSimilar({ id: t.id, mag: t.mag, features: featuresAt(t.mag, t.events, 3) }, lib);
    expect(ranked).toHaveLength(lib.length - 1);
    expect(ranked.some((m) => m.seq.id === t.id)).toBe(false);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i]!.distance).toBeGreaterThanOrEqual(ranked[i - 1]!.distance);
  });

  it("a sequence identical to a library member ranks it first at distance zero", () => {
    const t = by("Kaikoura");
    const ranked = rankSimilar({ id: "copy", mag: t.mag, features: featuresAt(t.mag, t.events, 3) }, lib);
    expect(ranked[0]!.seq.id).toBe(t.id);
    expect(ranked[0]!.distance).toBeCloseTo(0, 9);
  });
});
