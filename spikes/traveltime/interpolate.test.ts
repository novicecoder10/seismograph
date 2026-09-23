import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parseTable, travelTime, type TravelTimeTable } from "./interpolate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
let table: TravelTimeTable;
let truth: {
  samples: { phase: string; depthKm: number; distDeg: number; timeS: number | null }[];
};

beforeAll(() => {
  const buf = readFileSync(join(OUT, "traveltime.bin"));
  table = parseTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  truth = JSON.parse(readFileSync(join(OUT, "ground_truth.json"), "utf8"));
});

describe("parseTable", () => {
  it("reads the header", () => {
    expect(table.phases).toEqual(["P", "S", "PP", "PKP", "ScS"]);
    expect(table.data.length).toBe(table.phases.length * table.nDepths * table.nDist);
  });

  it("rejects a buffer with the wrong magic", () => {
    const bad = new ArrayBuffer(64);
    expect(() => parseTable(bad)).toThrow(/bad magic/);
  });
});

describe("travelTime", () => {
  it("matches ObsPy within 0.5 s RMS on off-grid samples", () => {
    const errors: number[] = [];
    let missAgree = 0;
    let missDisagree = 0;
    for (const s of truth.samples) {
      const got = travelTime(table, s.phase, s.depthKm, s.distDeg);
      if (s.timeS === null || got === null) {
        if (s.timeS === null && got === null) missAgree++;
        else missDisagree++;
        continue;
      }
      errors.push(got - s.timeS);
    }
    const rms = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
    const maxAbs = errors.reduce((m, e) => Math.max(m, Math.abs(e)), 0);
    console.log(
      `n=${errors.length} rms=${rms.toFixed(3)}s max=${maxAbs.toFixed(3)}s ` +
        `missAgree=${missAgree} missDisagree=${missDisagree}`,
    );
    expect(errors.length).toBeGreaterThan(100);
    expect(rms).toBeLessThan(0.5);
  });

  it("confines miss/hit disagreements to phase-cutoff boundaries", () => {
    // A bilinear cell is null if ANY corner is null, so the null boundary is
    // grid-quantised: it sits up to one cell inside the true cutoff. This test
    // measures that width, because Phase 5's wavefront glow must be at least
    // this wide or the front will show a gap at each phase cutoff.
    const disagreements: { phase: string; distDeg: number; gapDeg: number }[] = [];
    for (const s of truth.samples) {
      const got = travelTime(table, s.phase, s.depthKm, s.distDeg);
      const bothMiss = s.timeS === null && got === null;
      const bothHit = s.timeS !== null && got !== null;
      if (bothMiss || bothHit) continue;
      // Walk outward to the nearest distance where the two agree again.
      let gap = 0;
      for (let k = 1; k <= 8; k++) {
        gap = k * table.distStepDeg;
        const a = travelTime(table, s.phase, s.depthKm, s.distDeg - gap);
        const b = travelTime(table, s.phase, s.depthKm, s.distDeg + gap);
        if ((s.timeS === null) === (a === null) || (s.timeS === null) === (b === null)) break;
      }
      disagreements.push({ phase: s.phase, distDeg: s.distDeg, gapDeg: gap });
    }
    for (const d of disagreements) {
      console.log(`  boundary: ${d.phase} at ${d.distDeg.toFixed(2)}deg, ` +
        `resolved within ${d.gapDeg.toFixed(2)}deg`);
    }
    const worst = disagreements.reduce((m, d) => Math.max(m, d.gapDeg), 0);
    console.log(`boundary quantisation: ${disagreements.length} samples, ` +
      `worst ${worst.toFixed(2)}deg (grid step ${table.distStepDeg}deg)`);
    expect(worst).toBeLessThanOrEqual(table.distStepDeg * 4);
  });

  it("returns null in the P shadow zone, never zero", () => {
    expect(travelTime(table, "P", 0, 120)).toBeNull();
    expect(travelTime(table, "P", 0, 60)).toBeGreaterThan(400);
  });

  it("handles the exact grid edges without indexing out of bounds", () => {
    const zMax = table.depthMinKm + (table.nDepths - 1) * table.depthStepKm;
    for (const d of [0, 180]) {
      for (const z of [0, zMax]) {
        const v = travelTime(table, "P", z, d);
        expect(v === null || Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("returns null outside the grid rather than extrapolating", () => {
    expect(travelTime(table, "P", 0, 181)).toBeNull();
    expect(travelTime(table, "P", -1, 30)).toBeNull();
    expect(travelTime(table, "NOPE", 0, 30)).toBeNull();
    expect(travelTime(table, "P", NaN, 30)).toBeNull();
  });

  it("never returns NaN", () => {
    for (let d = 0; d <= 180; d += 0.37) {
      for (const phase of table.phases) {
        const v = travelTime(table, phase, 33, d);
        expect(v === null || !Number.isNaN(v)).toBe(true);
      }
    }
  });
});
