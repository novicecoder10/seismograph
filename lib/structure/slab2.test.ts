import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { downDipAzimuth, parseSlab2, SLAB_NAMES, slabDepthAt, slabMesh } from "./slab2";

const b = readFileSync("public/data/slab2.bin");
const slabs = parseSlab2(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

describe("Slab2", () => {
  it("parses all 27 slabs, each with a name", () => {
    expect(slabs).toHaveLength(27);
    for (const s of slabs) expect(SLAB_NAMES[s.code]).toBeDefined();
  });

  it("puts the 2026 Pematangsiantar M6.9 (175 km deep) just below the Sumatra slab top", () => {
    const d = slabDepthAt(slabs, 2.9863, 98.9853)!;
    expect(d.code).toBe("sum");
    expect(d.depthKm).toBeGreaterThan(140);
    expect(d.depthKm).toBeLessThan(175);
  });

  it("accepts negative longitudes and returns null away from slabs", () => {
    // Chile, near Santiago: the South America slab at intermediate depth.
    const chile = slabDepthAt(slabs, -33.4, -70.6)!;
    expect(chile.code).toBe("sam");
    expect(chile.depthKm).toBeGreaterThan(60);
    expect(slabDepthAt(slabs, 0, 0)).toBeNull(); // Gulf of Guinea
  });

  it("the Chilean slab dips east, the Japanese slab dips west", () => {
    const chile = downDipAzimuth(slabs, -30, -70)!;
    expect(chile).toBeGreaterThan(45);
    expect(chile).toBeLessThan(135);
    const japan = downDipAzimuth(slabs, 38, 141.5)!;
    expect(japan).toBeGreaterThan(225);
    expect(japan).toBeLessThan(315);
  });

  it("meshes only valid cells", () => {
    const m = slabMesh(slabs.find((s) => s.code === "sum")!);
    expect(m.indices.length % 3).toBe(0);
    expect(m.indices.length).toBeGreaterThan(1000);
    const nv = m.vertices.length / 3;
    for (const i of m.indices) expect(i).toBeLessThan(nv);
    for (let k = 2; k < m.vertices.length; k += 3) expect(Number.isFinite(m.vertices[k])).toBe(true);
  });
});
