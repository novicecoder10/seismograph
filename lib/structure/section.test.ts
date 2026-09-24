import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSlab2 } from "./slab2";
import { destination, profileFor, projectOnto, slabAlong, type Profile } from "./section";

const b = readFileSync("public/data/slab2.bin");
const slabs = parseSlab2(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

describe("section geometry", () => {
  const p: Profile = { lat: 0, lon: 0, azimuthDeg: 90, halfLengthKm: 500, halfWidthKm: 50, orientation: "east-west", slab: null };

  it("destination and projection invert each other", () => {
    for (const [az, km] of [[90, 300], [270, 120], [0, 40]] as const) {
      const q = destination(0, 0, az, km);
      const r = projectOnto(p, q.lat, q.lon);
      if (az === 90) { expect(r.alongKm).toBeCloseTo(300, 3); expect(r.acrossKm).toBeCloseTo(0, 3); }
      if (az === 270) expect(r.alongKm).toBeCloseTo(-120, 3);
      if (az === 0) { expect(Math.abs(r.acrossKm)).toBeCloseTo(40, 3); expect(Math.abs(r.alongKm)).toBeLessThan(1e-3); }
    }
  });

  it("orients down-dip across a slab, east-west elsewhere", () => {
    const chile = profileFor(-30, -71, slabs);
    expect(chile.orientation).toBe("down-dip");
    expect(chile.slab).toBe("sam");
    expect(chile.azimuthDeg).toBeGreaterThan(45);
    expect(chile.azimuthDeg).toBeLessThan(135);
    expect(profileFor(40, -100, slabs).orientation).toBe("east-west"); // Kansas
  });

  it("the Chilean slab deepens along the down-dip section", () => {
    const s = slabAlong(profileFor(-30, -71, slabs), slabs).filter((x) => x.depthKm !== null);
    expect(s.length).toBeGreaterThan(20);
    const first = s[0]!.depthKm!, last = s[s.length - 1]!.depthKm!;
    expect(last).toBeGreaterThan(first + 100);
  });
});
