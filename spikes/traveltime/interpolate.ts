// Throwaway spike. Bilinear interpolation over the TTV1 travel-time grid.
const MAGIC = 0x54545631;

export interface TravelTimeTable {
  phases: string[];
  nDepths: number;
  nDist: number;
  depthMinKm: number;
  depthStepKm: number;
  distMinDeg: number;
  distStepDeg: number;
  data: Float32Array;
}

export function parseTable(buf: ArrayBuffer): TravelTimeTable {
  const view = new DataView(buf);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) throw new Error(`bad magic 0x${magic.toString(16)}`);
  const nPhases = view.getUint32(4, true);
  const nDepths = view.getUint32(8, true);
  const nDist = view.getUint32(12, true);
  const depthMinKm = view.getFloat32(16, true);
  const depthStepKm = view.getFloat32(20, true);
  const distMinDeg = view.getFloat32(24, true);
  const distStepDeg = view.getFloat32(28, true);
  const phases: string[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < nPhases; i++) {
    const bytes = new Uint8Array(buf, 32 + i * 16, 16);
    phases.push(dec.decode(bytes).replace(/\0+$/, ""));
  }
  const offset = 32 + nPhases * 16;
  const data = new Float32Array(buf, offset, nPhases * nDepths * nDist);
  return { phases, nDepths, nDist, depthMinKm, depthStepKm, distMinDeg, distStepDeg, data };
}

/**
 * Travel time in seconds, or `null` when the phase does not arrive at that
 * distance or the query lies outside the grid. Never returns NaN, and never
 * returns 0 for a missing arrival — the P shadow zone is a real absence, not a
 * zero-second arrival.
 */
export function travelTime(
  table: TravelTimeTable,
  phase: string,
  depthKm: number,
  distDeg: number,
): number | null {
  const pi = table.phases.indexOf(phase);
  if (pi < 0) return null;

  const zMax = table.depthMinKm + (table.nDepths - 1) * table.depthStepKm;
  const xMax = table.distMinDeg + (table.nDist - 1) * table.distStepDeg;
  if (!(depthKm >= table.depthMinKm) || depthKm > zMax) return null;
  if (!(distDeg >= table.distMinDeg) || distDeg > xMax) return null;

  const zf = (depthKm - table.depthMinKm) / table.depthStepKm;
  const xf = (distDeg - table.distMinDeg) / table.distStepDeg;
  const z0 = Math.min(Math.floor(zf), table.nDepths - 2);
  const x0 = Math.min(Math.floor(xf), table.nDist - 2);
  const tz = zf - z0;
  const tx = xf - x0;

  const base = pi * table.nDepths * table.nDist;
  const at = (z: number, x: number) => table.data[base + z * table.nDist + x] as number;
  const v00 = at(z0, x0), v01 = at(z0, x0 + 1);
  const v10 = at(z0 + 1, x0), v11 = at(z0 + 1, x0 + 1);
  if ([v00, v01, v10, v11].some(Number.isNaN)) return null;

  const a = v00 * (1 - tx) + v01 * tx;
  const b = v10 * (1 - tx) + v11 * tx;
  const out = a * (1 - tz) + b * tz;
  return Number.isNaN(out) ? null : out;
}
