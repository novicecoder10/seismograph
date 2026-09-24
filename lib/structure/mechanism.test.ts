import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseNdk, polarity, rayForStereonet, tensorFromPlane } from "./mechanism";

const ndk = readFileSync("test/fixtures/gcmt/qcmt-head.ndk", "utf8");

describe("NDK parsing", () => {
  const ms = parseNdk(ndk);
  it("parses every five-line record", () => {
    expect(ms).toHaveLength(10);
    const first = ms[0]!;
    expect(first.id).toBe("C202601010153A");
    expect(first.lat).toBeCloseTo(-45.57, 2);
    expect(first.lon).toBeCloseTo(96.09, 2);
    expect(first.depthKm).toBeCloseTo(12, 1);
    // V10 1.448 2 261 -0.005 87 105 -1.446 1 351 1.447 | 36 87 1 | 306 89 177
    expect(first.planes).toEqual([{ strike: 36, dip: 87, rake: 1 }, { strike: 306, dip: 89, rake: 177 }]);
    expect(first.time).toBe(Date.UTC(2026, 0, 1, 1, 53, 1, 700) + 5800);
  });

  it("computes Mw from the scalar moment", () => {
    // M0 = 1.447e25 dyne-cm  ->  Mw = 2/3 (25.16 - 16.1) = 6.04
    expect(ms[0]!.mw).toBeCloseTo(6.04, 2);
  });

  it("the tensor from a nodal plane reproduces GCMT's tensor pattern", () => {
    for (const m of ms) {
      const dc = tensorFromPlane(m.planes[0]);
      // Same polarity pattern: sample the focal sphere.
      let agree = 0, total = 0;
      for (let x = -0.95; x <= 0.95; x += 0.1) for (let y = -0.95; y <= 0.95; y += 0.1) {
        const v = rayForStereonet(x, y);
        if (!v) continue;
        const a = polarity(m.m, v), b = polarity(dc, v);
        if (Math.abs(a) < 0.05 * Math.max(Math.abs(m.m.rr), Math.abs(m.m.tt), Math.abs(m.m.pp))) continue; // near a nodal plane
        total++;
        if (Math.sign(a) === Math.sign(b)) agree++;
      }
      expect(agree / total, m.id).toBeGreaterThan(0.9);
    }
  });
});

describe("focal sphere geometry", () => {
  it("a thrust puts compression at the centre of the beachball", () => {
    const thrust = tensorFromPlane({ strike: 0, dip: 30, rake: 90 });
    expect(polarity(thrust, rayForStereonet(0, 0)!)).toBeGreaterThan(0);
  });

  it("a normal fault puts dilatation at the centre", () => {
    const normal = tensorFromPlane({ strike: 0, dip: 60, rake: -90 });
    expect(polarity(normal, rayForStereonet(0, 0)!)).toBeLessThan(0);
  });

  it("a vertical strike-slip fault has four quadrants of alternating sign", () => {
    const ss = tensorFromPlane({ strike: 0, dip: 90, rake: 0 });
    const q = [[0.5, 0.5], [0.5, -0.5], [-0.5, -0.5], [-0.5, 0.5]].map(([x, y]) => Math.sign(polarity(ss, rayForStereonet(x!, y!)!)));
    expect(q[0]).toBe(-q[1]!);
    expect(q[1]).toBe(-q[2]!);
    expect(q[2]).toBe(-q[3]!);
  });

  it("outside the unit disc there is no ray", () => {
    expect(rayForStereonet(0.8, 0.8)).toBeNull();
  });
});
