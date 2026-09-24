import { akiUtsu, bPositive, type BValueEstimate } from "./bvalue";
import {
  declusterGardnerKnopoff,
  declusterZaliapin,
  gardnerKnopoffWindow,
  type CatalogEvent,
  type DeclusterResult,
} from "./decluster";
import { greatCircleKm } from "./distance";
import { binMagnitudes, cumulativeFromBins, inferBinWidth, type MagnitudeBins } from "./magnitude";
import { mcGft, mcMaxc, mcOverTime, mcSpatial, type McEstimate } from "./mc";
import { fitOmori, ogataResiduals, type OgataResult, type OmoriFit } from "./omori";
import { isRefusal, refuse, type Refusal } from "./refusal";

const DAY_MS = 86_400_000;
const ZBZ_MAX_EVENTS = 3000;
/** Frequency-magnitude statistics are computed on 0.1-unit bins even where a
 *  network reports two decimals (ComCat's CI and NC magnitudes): at 0.01 the
 *  histogram is mostly empty or single-count bins and MAXC chases noise. */
const MIN_ANALYSIS_BIN = 0.1;
const SWARM_GAP = 0.5;
const MIN_SEQUENCE = 5;

/** Wells & Coppersmith (1994), surface rupture length, all slip types. */
export function wellsCoppersmithRuptureKm(mw: number): number {
  return 10 ** (-3.22 + 0.69 * mw);
}

export interface QueryWindow {
  radiusKm: number;
  startMs: number;
  endMs: number;
  minMagnitude: number;
  rowLimit: number;
}

export function sequenceQueryWindow(mainshock: CatalogEvent, nowMs: number): QueryWindow {
  const gk = gardnerKnopoffWindow(mainshock.magnitude);
  const radiusKm = Math.min(300, Math.max(gk.radiusKm, 1.5 * wellsCoppersmithRuptureKm(mainshock.magnitude)));
  const endMs = Math.min(mainshock.time + Math.min(gk.days, 365) * DAY_MS, nowMs);
  return {
    radiusKm,
    startMs: mainshock.time - 30 * DAY_MS,
    endMs,
    minMagnitude: Math.max(1.5, Number((mainshock.magnitude - 4).toFixed(2))),
    rowLimit: 20_000,
  };
}

export type SequenceKind = "mainshock-aftershock" | "swarm" | "isolated";

export interface Classification {
  kind: SequenceKind;
  reasons: string[];
  magnitudeGap: number | null;
  largestId: string | null;
  /** Largest event minus the largest event after it. Båth's law expects ≈1.2. */
  bathDelta: number | null;
}

export function classifySequence(members: CatalogEvent[], mainshockId: string): Classification {
  if (members.length < MIN_SEQUENCE) {
    return {
      kind: "isolated",
      reasons: [`Only ${members.length} event(s) in the sequence window; at least ${MIN_SEQUENCE} make a sequence.`],
      magnitudeGap: null,
      largestId: members.length > 0 ? [...members].sort((a, b) => b.magnitude - a.magnitude)[0]!.id : null,
      bathDelta: null,
    };
  }
  const byMag = [...members].sort((a, b) => b.magnitude - a.magnitude || a.time - b.time);
  const largest = byMag[0]!;
  const gap = Number((largest.magnitude - byMag[1]!.magnitude).toFixed(4));
  const after = members.filter((e) => e.time > largest.time);
  const bathDelta = after.length > 0
    ? Number((largest.magnitude - Math.max(...after.map((e) => e.magnitude))).toFixed(4))
    : null;

  const reasons: string[] = [];
  if (largest.id !== mainshockId) {
    reasons.push(
      `A larger event (M ${largest.magnitude.toFixed(1)}) occurred in this window; ` +
        "the event opened is a foreshock or part of a swarm, not the mainshock.",
    );
  }
  let kind: SequenceKind;
  if (gap >= SWARM_GAP) {
    kind = "mainshock-aftershock";
    reasons.push(
      `The largest event exceeds the next largest by ${gap.toFixed(1)} magnitude units ` +
        `(this project calls a gap of ${SWARM_GAP} or more a dominant mainshock).`,
    );
  } else {
    kind = "swarm";
    reasons.push(
      `The two largest events differ by only ${gap.toFixed(1)} magnitude units, below the ` +
        `${SWARM_GAP} this project requires for a dominant mainshock.`,
    );
  }
  if (bathDelta !== null) {
    reasons.push(
      `The largest later event is ${bathDelta.toFixed(1)} units smaller; Båth's law describes ` +
        "an average of about 1.2 across many sequences.",
    );
  }
  return { kind, reasons, magnitudeGap: gap, largestId: largest.id, bathDelta };
}

export interface DeclusterSummary {
  method: DeclusterResult["method"];
  mainshockClusterSize: number;
  clusters: number;
  independent: number;
  /** Set when the input was restricted to keep an O(n²) method tractable. */
  restrictedAboveMagnitude: number | null;
  memberIds: string[];
}

export interface SequenceAnalysis {
  mainshock: CatalogEvent;
  window: QueryWindow;
  events: CatalogEvent[];
  aftershocks: CatalogEvent[];
  classification: Classification;
  bins: MagnitudeBins;
  cumulative: number[];
  mc: { maxc: McEstimate | Refusal; gft: McEstimate | Refusal; used: number | null };
  bValue: { akiUtsu: BValueEstimate | Refusal; bPositive: BValueEstimate | Refusal };
  omori: OmoriFit | Refusal;
  ogata: OgataResult | null;
  mcOverTime: { timeMs: number; mc: number; sigma: number; n: number }[];
  mcSpatial: { lat: number; lon: number; mc: number; sigma: number; n: number }[];
  declustering: {
    gardnerKnopoff: DeclusterSummary;
    zaliapin: DeclusterSummary;
    agreement: { both: number; onlyGk: number; onlyZbz: number };
  };
}

function summarise(r: DeclusterResult, mainshockId: string, restricted: number | null): DeclusterSummary {
  const cluster = r.clusters.find((c) => c.memberIds.includes(mainshockId));
  return {
    method: r.method,
    mainshockClusterSize: cluster?.memberIds.length ?? 1,
    clusters: r.clusters.length,
    independent: r.independentIds.length,
    restrictedAboveMagnitude: restricted,
    memberIds: cluster?.memberIds ?? [mainshockId],
  };
}

export function analyseSequence(
  mainshock: CatalogEvent,
  local: CatalogEvent[],
  nowMs: number,
): SequenceAnalysis {
  const window = sequenceQueryWindow(mainshock, nowMs);
  const byId = new Map<string, CatalogEvent>();
  for (const e of [mainshock, ...local]) {
    if (e.time < window.startMs || e.time > window.endMs) continue;
    if (greatCircleKm(mainshock.lat, mainshock.lon, e.lat, e.lon) > window.radiusKm) continue;
    byId.set(e.id, e);
  }
  const events = [...byId.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const aftershocks = events.filter((e) => e.time > mainshock.time);
  const classification = classifySequence(events, mainshock.id);

  const binWidth = Math.max(MIN_ANALYSIS_BIN, inferBinWidth(events.map((e) => e.magnitude)));
  const toBin = (m: number) => Number((Math.round(m / binWidth + 1e-9) * binWidth).toFixed(3));
  const binned = events.map((e) => ({ ...e, magnitude: toBin(e.magnitude) }));
  const mags = binned.map((e) => e.magnitude);
  const bins = binMagnitudes(mags, binWidth);
  const cumulative = cumulativeFromBins(bins);

  const maxc = mcMaxc(mags, { binWidth, seed: 1 });
  const gft = mcGft(mags, { binWidth, seed: 1 });
  const candidates = [maxc, gft].filter((m): m is McEstimate => !isRefusal(m)).map((m) => m.mc);
  const used = candidates.length > 0 ? Math.max(...candidates) : null;

  const isolated = classification.kind === "isolated";
  const noMc = refuse("Completeness could not be estimated, so no statistic above it can be.");
  const aki = isolated || used === null ? (isolated ? refuse(classification.reasons[0]!) : noMc) : akiUtsu(mags, used, binWidth);
  const pos = isolated ? refuse(classification.reasons[0]!) : bPositive(binned, { binWidth });

  let omori: OmoriFit | Refusal;
  if (isolated) omori = refuse(classification.reasons[0]!);
  else if (classification.kind === "swarm") {
    omori = refuse(
      "This looks like a swarm, not a mainshock-aftershock sequence. Omori's law describes decay " +
        "after a dominant mainshock and returns meaningless parameters for a swarm.",
    );
  } else if (used === null) omori = noMc;
  else {
    const times = aftershocks
      .filter((e) => e.magnitude >= used - 1e-9)
      .map((e) => (e.time - mainshock.time) / DAY_MS);
    omori = fitOmori(times, { startDays: 0, endDays: (window.endMs - mainshock.time) / DAY_MS });
  }
  const ogata = isRefusal(omori)
    ? null
    : ogataResiduals(
        aftershocks.filter((e) => e.magnitude >= (used ?? -Infinity) - 1e-9).map((e) => (e.time - mainshock.time) / DAY_MS),
        omori,
      );

  const gkResult = declusterGardnerKnopoff(events);
  let zbzInput = events;
  let restricted: number | null = null;
  if (events.length > ZBZ_MAX_EVENTS) {
    const floor = [...events].sort((a, b) => b.magnitude - a.magnitude)[ZBZ_MAX_EVENTS - 1]!.magnitude;
    restricted = floor;
    zbzInput = events.filter((e) => e.magnitude >= floor || e.id === mainshock.id);
  }
  const zbzResult = declusterZaliapin(zbzInput);
  const gk = summarise(gkResult, mainshock.id, null);
  const zbz = summarise(zbzResult, mainshock.id, restricted);
  const gkSet = new Set(gk.memberIds);
  const zbzSet = new Set(zbz.memberIds);
  const agreement = {
    both: [...gkSet].filter((id) => zbzSet.has(id)).length,
    onlyGk: [...gkSet].filter((id) => !zbzSet.has(id)).length,
    onlyZbz: [...zbzSet].filter((id) => !gkSet.has(id)).length,
  };

  return {
    mainshock,
    window,
    events,
    aftershocks,
    classification,
    bins,
    cumulative,
    mc: { maxc, gft, used },
    bValue: { akiUtsu: aki, bPositive: pos },
    omori,
    ogata,
    mcOverTime: mcOverTime(binned, { window: Math.max(100, Math.min(250, Math.floor(events.length / 4))) }),
    mcSpatial: mcSpatial(binned, { cellDeg: 0.25, minPerCell: 50 }),
    declustering: { gardnerKnopoff: gk, zaliapin: zbz, agreement },
  };
}
