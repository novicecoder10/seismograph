import { describe, expect, it } from "vitest";
import {
  declusterGardnerKnopoff,
  declusterZaliapin,
  gardnerKnopoffWindow,
  nearestNeighbourDistance,
  type CatalogEvent,
} from "./decluster";

const DAY = 86_400_000;
const base = Date.UTC(2026, 0, 1);

const ev = (
  id: string,
  dayOffset: number,
  magnitude: number,
  lat = 35.0,
  lon = -117.0,
): CatalogEvent => ({
  id,
  time: base + dayOffset * DAY,
  lat,
  lon,
  depthKm: 8,
  magnitude,
});

describe("gardnerKnopoffWindow", () => {
  // Gardner & Knopoff (1974), Table 1. The closed form in the implementation is
  // van Stiphout et al.'s (2012) regression FIT to this table, so it is checked
  // against the published values with the tolerance a fit implies — radius to
  // within 3%, duration to within 10% — rather than to the kilometre and day.
  const TABLE: [number, number, number][] = [
    // M,  L (km), T (days)
    [2.5, 19.5, 6],
    [3.0, 22.5, 11.5],
    [3.5, 26, 22],
    [4.0, 30, 42],
    [4.5, 35, 83],
    [5.0, 40, 155],
    [5.5, 47, 290],
    [6.0, 54, 510],
    [7.0, 70, 915],
    [7.5, 81, 960],
    [8.0, 94, 985],
  ];
  for (const [m, L, T] of TABLE) {
    it(`reproduces the published window for M ${m.toFixed(1)}`, () => {
      const w = gardnerKnopoffWindow(m);
      expect(Math.abs(w.radiusKm - L) / L).toBeLessThan(0.03);
      expect(Math.abs(w.days - T) / T).toBeLessThan(0.1);
    });
  }

  it("grows monotonically with magnitude", () => {
    let prevR = 0;
    let prevT = 0;
    for (let m = 2.5; m <= 8; m += 0.5) {
      const w = gardnerKnopoffWindow(m);
      expect(w.radiusKm).toBeGreaterThan(prevR);
      expect(w.days).toBeGreaterThan(prevT);
      prevR = w.radiusKm;
      prevT = w.days;
    }
  });
});

describe("declusterGardnerKnopoff", () => {
  it("groups aftershocks inside the mainshock's window", () => {
    const events = [
      ev("main", 0, 6.0),
      ev("a1", 1, 4.0, 35.05),
      ev("a2", 10, 3.5, 35.1),
      ev("far", 5, 3.5, 40.0), // ~550 km away, outside the 54 km window
    ];
    const r = declusterGardnerKnopoff(events);
    const cluster = r.clusters.find((c) => c.mainshockId === "main")!;
    expect(cluster.memberIds).toContain("a1");
    expect(cluster.memberIds).toContain("a2");
    expect(cluster.memberIds).not.toContain("far");
    expect(r.independentIds).toContain("far");
  });

  it("treats an event outside the time window as independent", () => {
    // The M6 window is ~500 days; 600 days later is outside it.
    const events = [ev("main", 0, 6.0), ev("late", 600, 4.0, 35.02)];
    const r = declusterGardnerKnopoff(events);
    expect(r.independentIds).toContain("late");
  });

  it("promotes a later larger event to mainshock", () => {
    // A foreshock sequence: the M6 five days in is the mainshock, not the M4.
    const events = [ev("fore", 0, 4.0), ev("main", 5, 6.0, 35.01), ev("after", 6, 4.2, 35.02)];
    const r = declusterGardnerKnopoff(events);
    const cluster = r.clusters[0]!;
    expect(cluster.mainshockId).toBe("main");
    expect(cluster.memberIds).toContain("fore");
    expect(cluster.memberIds).toContain("after");
  });

  it("returns every event as independent when nothing clusters", () => {
    const events = [ev("a", 0, 4.0), ev("b", 300, 4.0, 45), ev("c", 600, 4.0, -20)];
    const r = declusterGardnerKnopoff(events);
    expect(r.independentIds).toHaveLength(3);
    expect(r.clusters).toHaveLength(0);
  });

  it("handles an unsorted catalogue identically to a sorted one", () => {
    const sorted = [ev("main", 0, 6.0), ev("a1", 1, 4.0, 35.05), ev("a2", 3, 4.0, 35.06)];
    const shuffled = [sorted[2]!, sorted[0]!, sorted[1]!];
    const a = declusterGardnerKnopoff(sorted);
    const b = declusterGardnerKnopoff(shuffled);
    expect(new Set(b.clusters[0]!.memberIds)).toEqual(new Set(a.clusters[0]!.memberIds));
  });

  it("clusters across the antimeridian rather than splitting a sequence in two", () => {
    const events = [
      { ...ev("main", 0, 6.0), lon: 179.9 },
      { ...ev("a1", 1, 4.0), lon: -179.9 }, // ~22 km away, not 360 degrees
    ];
    const r = declusterGardnerKnopoff(events);
    expect(r.clusters[0]!.memberIds).toContain("a1");
  });

  it("clusters near the pole by distance, not by degrees", () => {
    const events = [
      { ...ev("main", 0, 6.0), lat: 85, lon: 0 },
      { ...ev("a1", 1, 4.0), lat: 85, lon: 40 }, // ~388 km: outside the window
      { ...ev("a2", 1, 4.0), lat: 85.2, lon: 1 }, // ~23 km: inside
    ];
    const r = declusterGardnerKnopoff(events);
    const members = r.clusters[0]!.memberIds;
    expect(members).toContain("a2");
    expect(members).not.toContain("a1");
  });

  it("returns empty structures for an empty catalogue", () => {
    const r = declusterGardnerKnopoff([]);
    expect(r.clusters).toHaveLength(0);
    expect(r.independentIds).toHaveLength(0);
  });
});

describe("nearestNeighbourDistance", () => {
  it("is null for a child that precedes its candidate parent", () => {
    expect(nearestNeighbourDistance(ev("p", 5, 5), ev("c", 1, 4))).toBeNull();
  });

  it("factorises into rescaled time and rescaled distance", () => {
    const r = nearestNeighbourDistance(ev("p", 0, 6), ev("c", 10, 4, 35.1))!;
    expect(r.eta).toBeCloseTo(r.rescaledTime * r.rescaledDistance, 9);
  });

  it("falls as the parent magnitude rises: a bigger parent claims more", () => {
    const small = nearestNeighbourDistance(ev("p", 0, 4), ev("c", 10, 3, 35.1))!;
    const large = nearestNeighbourDistance(ev("p", 0, 7), ev("c", 10, 3, 35.1))!;
    expect(large.eta).toBeLessThan(small.eta);
  });

  it("rises with elapsed time and with separation", () => {
    const near = nearestNeighbourDistance(ev("p", 0, 6), ev("c", 1, 4, 35.01))!;
    const later = nearestNeighbourDistance(ev("p", 0, 6), ev("c", 100, 4, 35.01))!;
    const further = nearestNeighbourDistance(ev("p", 0, 6), ev("c", 1, 4, 36.0))!;
    expect(later.eta).toBeGreaterThan(near.eta);
    expect(further.eta).toBeGreaterThan(near.eta);
  });

  it("does not return zero or infinity for a co-located simultaneous pair", () => {
    // Both r = 0 and t = 0 are real in a catalogue with rounded times and
    // positions; log(0) would poison every downstream statistic.
    const p = ev("p", 0, 6);
    const c = { ...ev("c", 0, 4), lat: p.lat, lon: p.lon };
    const r = nearestNeighbourDistance(p, c);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.eta)).toBe(true);
    expect(r!.eta).toBeGreaterThan(0);
  });
});

describe("declusterZaliapin", () => {
  it("links an aftershock to its mainshock", () => {
    const events = [
      ev("main", 0, 6.5),
      ev("a1", 0.5, 4.0, 35.02),
      ev("a2", 2, 3.8, 35.03),
      ev("independent", 300, 4.5, 20.0, 100.0),
    ];
    const r = declusterZaliapin(events);
    const cluster = r.clusters.find((c) => c.memberIds.includes("a1"))!;
    expect(cluster.mainshockId).toBe("main");
    expect(cluster.memberIds).toContain("a2");
    expect(r.independentIds).toContain("independent");
  });

  it("labels its method so the two results can be told apart in the UI", () => {
    expect(declusterZaliapin([ev("a", 0, 5)]).method).toBe("zaliapin-nn");
    expect(declusterGardnerKnopoff([ev("a", 0, 5)]).method).toBe("gardner-knopoff");
  });

  it("disagrees with Gardner-Knopoff on a migrating swarm, which is the point", () => {
    // Twenty M4 events marching 5 km a day along a line, 95 km end to end. A
    // tight swarm is linked by BOTH methods, correctly. What separates them is
    // migration: the nearest-neighbour statistic chains each event to the one
    // before it and follows the swarm the whole way; Gardner-Knopoff's fixed
    // ~32 km window around the largest event cannot.
    const kmPerDegLat = 111.19;
    const swarm = Array.from({ length: 20 }, (_, i) =>
      ev(`s${i}`, i, 4.0 + (i % 3) * 0.1, (i * 5) / kmPerDegLat, 0),
    );
    const gk = declusterGardnerKnopoff(swarm);
    const zbz = declusterZaliapin(swarm);
    const gkLargest = Math.max(0, ...gk.clusters.map((c) => c.memberIds.length));
    const zbzLargest = Math.max(0, ...zbz.clusters.map((c) => c.memberIds.length));
    expect(zbzLargest).toBe(20);
    expect(gkLargest).toBeLessThan(zbzLargest);
  });

  it("links a tight swarm under both methods", () => {
    const swarm = Array.from({ length: 20 }, (_, i) =>
      ev(`s${i}`, i * 0.5, 4.4 + (i % 3) * 0.05, i * 0.002, i * 0.002),
    );
    const gk = Math.max(0, ...declusterGardnerKnopoff(swarm).clusters.map((c) => c.memberIds.length));
    const zbz = Math.max(0, ...declusterZaliapin(swarm).clusters.map((c) => c.memberIds.length));
    expect(gk).toBe(20);
    expect(zbz).toBe(20);
  });

  it("returns every event as independent for a sparse, scattered catalogue", () => {
    const scattered = [
      ev("a", 0, 5, 0, 0),
      ev("b", 200, 5, 40, 80),
      ev("c", 400, 5, -30, -70),
    ];
    expect(declusterZaliapin(scattered).independentIds).toHaveLength(3);
  });

  it("handles an unsorted catalogue", () => {
    const events = [ev("a2", 2, 3.8, 35.03), ev("main", 0, 6.5), ev("a1", 0.5, 4.0, 35.02)];
    const r = declusterZaliapin(events);
    expect(r.clusters[0]!.mainshockId).toBe("main");
  });
});
