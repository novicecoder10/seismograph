import { readFileSync } from "node:fs";
import path from "node:path";
import type { GenericRj, PageCompleteness } from "../science/rj";

/**
 * Tectonic regime lookup and the generic Reasenberg-Jones parameters USGS uses
 * outside its own regional models. Everything here is copied from
 * opensha/opensha-oaf (CC0): TectonicRegimeTable.java and its .dat file,
 * GenericRJ_ParametersFetch.json (Page et al. 2016) and MagCompPage_ParametersFetch.json.
 * Server-only: the table is read from disk.
 */

/** STREC names in table index order, each with its Garcia et al. (2012) regime code. */
export const REGIMES = [
  ["ACR (deep)", "ANSR-DEEPCON"],
  ["ACR (hot spot)", "ANSR-HOTSPOT"],
  ["ACR (oceanic boundary)", "ANSR-OCEANBD"],
  ["ACR (shallow)", "ANSR-SHALCON"],
  ["ACR deep (above slab)", "ANSR-ABSLDEC"],
  ["ACR oceanic boundary (above slab)", "ANSR-ABSLOCB"],
  ["ACR shallow (above slab)", "ANSR-ABSLSHC"],
  ["SCR (above slab)", "SCR-ABVSLAB"],
  ["SCR (generic)", "SCR-GENERIC"],
  ["SOR (above slab)", "SOR-ABVSLAB"],
  ["SOR (generic)", "SOR-GENERIC"],
  ["SZ (generic)", "SZ-GENERIC"],
  ["SZ (inland/back-arc)", "SZ-INLBACK"],
  ["SZ (on-shore)", "SZ-ONSHORE"],
  ["SZ (outer-trench)", "SZ-OUTERTR"],
] as const;

export type RegimeCode = (typeof REGIMES)[number][1];

/** Plain-language names for display. */
export const REGIME_DESCRIPTION: Record<RegimeCode, string> = {
  "ANSR-DEEPCON": "active continental crust, deep",
  "ANSR-HOTSPOT": "volcanic hot spot",
  "ANSR-OCEANBD": "oceanic plate boundary (ridge or transform)",
  "ANSR-SHALCON": "active continental crust, shallow",
  "ANSR-ABSLDEC": "active crust above a subducting slab, deep",
  "ANSR-ABSLOCB": "oceanic boundary above a subducting slab",
  "ANSR-ABSLSHC": "active crust above a subducting slab, shallow",
  "SCR-ABVSLAB": "stable continental interior above a slab",
  "SCR-GENERIC": "stable continental interior",
  "SOR-ABVSLAB": "stable oceanic crust above a slab",
  "SOR-GENERIC": "stable oceanic crust",
  "SZ-GENERIC": "subduction zone",
  "SZ-INLBACK": "subduction zone, inland or back-arc",
  "SZ-ONSHORE": "subduction zone, on-shore",
  "SZ-OUTERTR": "subduction zone, outer trench",
};

export const GENERIC_RJ: Record<RegimeCode, GenericRj> = {
  "ANSR-ABSLDEC": { aMean: -2.29, aSigma: 0.63, aSigma0: 0.49, aSigma1: 560, b: 1.0, p: 1.01, c: 0.018 },
  "ANSR-ABSLOCB": { aMean: -2.82, aSigma: 0.8, aSigma0: 0.49, aSigma1: 890, b: 1.0, p: 0.64, c: 0.018 },
  "ANSR-ABSLSHC": { aMean: -2.85, aSigma: 0.75, aSigma0: 0.49, aSigma1: 800, b: 1.0, p: 1.06, c: 0.018 },
  "ANSR-DEEPCON": { aMean: -2.13, aSigma: 0.52, aSigma0: 0.49, aSigma1: 250, b: 1.0, p: 0.98, c: 0.018 },
  "ANSR-HOTSPOT": { aMean: -3.0, aSigma: 0.68, aSigma0: 0.49, aSigma1: 680, b: 1.0, p: 1.12, c: 0.018 },
  "ANSR-OCEANBD": { aMean: -3.19, aSigma: 0.6, aSigma0: 0.49, aSigma1: 500, b: 1.0, p: 1.08, c: 0.018 },
  "ANSR-SHALCON": { aMean: -2.42, aSigma: 0.63, aSigma0: 0.49, aSigma1: 570, b: 1.0, p: 0.98, c: 0.018 },
  "SCR-GENERIC": { aMean: -2.85, aSigma: 0.78, aSigma0: 0.49, aSigma1: 870, b: 1.0, p: 0.73, c: 0.018 },
  "SOR-GENERIC": { aMean: -3.04, aSigma: 0.67, aSigma0: 0.49, aSigma1: 650, b: 1.0, p: 0.97, c: 0.018 },
  "SZ-GENERIC": { aMean: -2.47, aSigma: 0.63, aSigma0: 0.49, aSigma1: 570, b: 1.0, p: 0.88, c: 0.018 },
  "SZ-INLBACK": { aMean: -2.43, aSigma: 0.66, aSigma0: 0.49, aSigma1: 640, b: 1.0, p: 0.86, c: 0.018 },
  "SZ-ONSHORE": { aMean: -2.34, aSigma: 0.6, aSigma0: 0.49, aSigma1: 500, b: 1.0, p: 0.81, c: 0.018 },
  "SZ-OUTERTR": { aMean: -2.42, aSigma: 0.64, aSigma0: 0.49, aSigma1: 540, b: 1.0, p: 0.92, c: 0.018 },
  "SCR-ABVSLAB": { aMean: -2.85, aSigma: 0.78, aSigma0: 0.49, aSigma1: 870, b: 1.0, p: 0.73, c: 0.018 },
  "SOR-ABVSLAB": { aMean: -3.04, aSigma: 0.67, aSigma0: 0.49, aSigma1: 650, b: 1.0, p: 0.97, c: 0.018 },
};

/** USGS's completeness and search settings outside its regional networks ("WORLD"). */
export const WORLD = {
  completeness: { magCat: 4.6, F: 0.5, G: 0.25, H: 1.0 } satisfies PageCompleteness,
  sampleMagnitude: 2.95,
  centroidMagnitude: 3.95,
  radiusMinKm: 10,
  radiusMaxKm: 2000,
  aGrid: { min: -4.5, max: -0.5, delta: 0.01 },
};

const LAT_COUNT = 3601;
const LON_COUNT = 7201;
const DOMAINS = REGIMES.length;

interface Table {
  groupCol: Int32Array[];
  domain: Uint8Array[];
}
let table: Table | null = null;

/** Parse the table exactly as TectonicRegimeTable.load_tables does. */
export function parseRegimeTable(text: string): Table {
  const ints = text.split(/\s+/).filter(Boolean).map(Number);
  let i = 0;
  const next = () => {
    const v = ints[i++];
    if (v === undefined || !Number.isInteger(v)) throw new Error(`regime table: bad integer at ${i - 1}`);
    return v;
  };
  let remaining = LAT_COUNT * LON_COUNT;
  for (let d = 0; d < DOMAINS; d++) remaining -= next();
  if (remaining !== 0) throw new Error("regime table: point counts do not cover the grid");
  const groupCol: Int32Array[] = [];
  const domain: Uint8Array[] = [];
  for (let row = 0; row < LAT_COUNT; row++) {
    const n = next();
    const cols = new Int32Array(n);
    const doms = new Uint8Array(n);
    for (let g = 0; g < n; g++) cols[g] = next();
    for (let g = 0; g < n; g++) {
      const d = next();
      if (d < 0 || d >= DOMAINS) throw new Error(`regime table: domain ${d} out of range`);
      doms[g] = d;
    }
    groupCol.push(cols);
    domain.push(doms);
  }
  return { groupCol, domain };
}

function load(): Table {
  if (!table) {
    table = parseRegimeTable(readFileSync(path.join(process.cwd(), "data/oaf/TectonicRegimeTable.dat"), "utf8"));
  }
  return table;
}

export function regimeAt(lat: number, lon: number): { strec: string; code: RegimeCode } {
  const t = load();
  const row = Math.min(LAT_COUNT - 1, Math.max(0, Math.round(((Math.min(90, Math.max(-90, lat)) + 90) / 180) * (LAT_COUNT - 1))));
  let l = lon;
  while (l > 180) l -= 360;
  while (l < -180) l += 360;
  let col = Math.round(((l + 180) / 360) * (LON_COUNT - 1));
  if (col < 0) col = LON_COUNT - 1;
  else if (col >= LON_COUNT) col = 0;
  const cols = t.groupCol[row]!;
  let lo = 0;
  let hi = cols.length;
  while (hi - lo > 1) {
    const mid = (hi + lo) >> 1;
    if (cols[mid]! <= col) lo = mid;
    else hi = mid;
  }
  const [strec, code] = REGIMES[t.domain[row]![lo]!]!;
  return { strec, code };
}
