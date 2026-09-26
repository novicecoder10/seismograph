import type { Event } from "../events/types";
import { REGIME_DESCRIPTION, type RegimeCode } from "../oaf/regimes";
import type { SequenceAnalysis } from "../science/sequence";

/**
 * Evidence for the plain-language layer, beyond sequence comparisons: one
 * earthquake (the globe's card, the event page, questions about it) and one
 * aftershock sequence (the sequence page). As with the comparison bundle, every
 * number is formatted here once, as a display string, so the model copies
 * rather than computes, and the verifier can check each one exactly.
 */

const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clock = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
const mag = (m: number) => `M ${m.toFixed(1)}`;

export function magnitudeTypeName(t: string | null): string {
  const s = (t ?? "").toLowerCase();
  if (s.startsWith("mw")) return "moment magnitude, from the size of the fault slip";
  if (s.startsWith("mb")) return "body-wave magnitude, from the first seismic waves";
  if (s.startsWith("ms")) return "surface-wave magnitude";
  if (s.startsWith("ml")) return "local magnitude";
  if (s.startsWith("md") || s.startsWith("mc")) return "duration magnitude";
  return "magnitude";
}

export function depthClass(km: number | null): string {
  if (km === null) return "of unreported depth";
  if (km < 70) return "shallow (less than 70 km deep)";
  if (km <= 300) return "intermediate-depth (70 to 300 km deep)";
  return "deep (more than 300 km deep)";
}

export interface EventEvidence {
  v: 2;
  kind: "event";
  event: {
    id: string;
    mag: string;
    magType: string;
    magTypeName: string;
    place: string;
    date: string;
    time: string;
    depth: string;
    depthClass: string;
    setting: string;
    review: string;
  };
  caveats: string[];
}

/**
 * Only facts that do not change once an event is reviewed: the card's summary
 * is written once per earthquake and kept, which is what keeps a free model's
 * daily quota enough.
 */
export function eventEvidence(e: Event, regime: RegimeCode | null): EventEvidence {
  const caveats = [
    "Magnitudes and locations are revised as more data arrive.",
  ];
  if (e.depthKm !== null && Math.abs(e.depthKm - 10) < 1e-6) {
    caveats.push("A depth of exactly 10 km is often a default the network assigns when the true depth was not well measured.");
  }
  return {
    v: 2,
    kind: "event",
    event: {
      id: e.id,
      mag: mag(e.magnitude),
      magType: e.magType ?? "",
      magTypeName: magnitudeTypeName(e.magType),
      place: e.place,
      date: date(e.time),
      time: clock(e.time),
      depth: e.depthKm === null ? "unreported" : `${e.depthKm.toFixed(e.depthKm < 10 ? 1 : 0)} km`,
      depthClass: depthClass(e.depthKm),
      setting: regime ? REGIME_DESCRIPTION[regime] : "not classified",
      review: e.status === "reviewed" ? "reviewed by a seismologist" : "an automatic solution, not yet reviewed by a seismologist",
    },
    caveats,
  };
}

export function eventTemplate(ev: EventEvidence): string[] {
  const e = ev.event;
  const where = /^\d/.test(e.place) ? e.place : `near ${e.place}`;
  return [
    `An ${e.mag} earthquake (${e.magTypeName}) occurred ${where} on ${e.date} at ${e.time}. It was ${e.depthClass === "of unreported depth" ? "of unreported depth" : `${e.depthClass}, at ${e.depth}`}.`,
    `The tectonic setting there is: ${e.setting}. The solution is ${e.review}.${ev.caveats.length > 1 ? ` ${ev.caveats[1]}` : ""}`,
  ];
}

export interface SequenceEvidence {
  v: 2;
  kind: "sequence";
  event: { id: string; mag: string; place: string; date: string };
  sequence: {
    elapsed: string;
    radius: string;
    floor: string;
    count: string;
    aftershocks: string;
    kind: string;
    largestAftershock: string;
    bathGap: string;
    completeness: string;
    bValue: string;
    omori: string;
    declustering: string;
  };
  caveats: string[];
}

const KIND: Record<string, string> = {
  "mainshock-aftershock": "a mainshock followed by aftershocks",
  swarm: "a swarm: many earthquakes of similar size, without one clearly larger mainshock",
  isolated: "an isolated event, with few or no aftershocks recorded",
};

function elapsedText(days: number): string {
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"}`;
  if (days < 1 / 24) return n(Math.max(1, Math.round(days * 1440)), "minute");
  if (days < 2) return n(Math.max(1, Math.round(days * 24)), "hour");
  if (days < 60) return n(Math.round(days), "day");
  return n(Math.round(days / 30.44), "month");
}

export function sequenceEvidence(a: SequenceAnalysis, nowMs: number, place: string): SequenceEvidence {
  const ms = a.mainshock;
  const after = [...a.aftershocks].sort((x, y) => y.magnitude - x.magnitude);
  const largest = after[0];
  const refused = (r: unknown) => (r as { refused?: boolean }).refused === true;
  const mc = a.mc.maxc;
  const b = a.bValue.akiUtsu;
  const om = a.omori;
  const gk = a.declustering.gardnerKnopoff, zb = a.declustering.zaliapin;
  return {
    v: 2,
    kind: "sequence",
    event: { id: ms.id, mag: mag(ms.magnitude), place, date: date(ms.time) },
    sequence: {
      elapsed: elapsedText((Math.min(nowMs, a.window.endMs) - ms.time) / 86_400_000),
      radius: `${Math.round(a.window.radiusKm)} km`,
      floor: `M ${a.window.minMagnitude.toFixed(1)}`,
      count: String(a.events.length),
      aftershocks: String(a.aftershocks.length),
      kind: KIND[a.classification.kind] ?? a.classification.kind,
      largestAftershock: largest ? `${mag(largest.magnitude)}, ${elapsedText((largest.time - ms.time) / 86_400_000)} after the mainshock` : "none recorded",
      bathGap: a.classification.bathDelta === null ? "not available" : `${a.classification.bathDelta.toFixed(1)} magnitude units`,
      completeness: refused(mc) ? `not estimated: ${(mc as { reason: string }).reason}` : `M ${(mc as { mc: number }).mc.toFixed(1)} ± ${(mc as { sigma: number }).sigma.toFixed(2)}`,
      bValue: refused(b)
        ? `not estimated: ${(b as { reason: string }).reason}`
        : `${(b as { b: number }).b.toFixed(2)}, with a 95% range of ${(b as { ci95: [number, number] }).ci95[0].toFixed(2)} to ${(b as { ci95: [number, number] }).ci95[1].toFixed(2)}`,
      omori: refused(om)
        ? `not fitted: ${(om as { reason: string }).reason}`
        : `p = ${(om as { p: number }).p.toFixed(2)}${(om as { ci95P: [number, number] | null }).ci95P ? `, with a 95% range of ${(om as { ci95P: [number, number] }).ci95P[0].toFixed(2)} to ${(om as { ci95P: [number, number] }).ci95P[1].toFixed(2)}` : ""}`,
      declustering: `the Gardner-Knopoff method groups ${gk.mainshockClusterSize} events with the mainshock, the Zaliapin method ${zb.mainshockClusterSize}`,
    },
    caveats: [
      "Counts include only earthquakes the catalogue records completely, above its completeness magnitude.",
      "These statistics describe the sequence so far.",
    ],
  };
}

export function sequenceTemplate(s: SequenceEvidence): string[] {
  const q = s.sequence;
  const place = s.event.place;
  return [
    `In the ${q.elapsed} since the ${s.event.mag} of ${s.event.date}${place ? `, ${place}` : ""}, the catalogue records ${q.count} earthquakes of ${q.floor} or larger within ${q.radius}, ${q.aftershocks} of them after the mainshock. The pattern is ${q.kind}.`,
    `The largest aftershock so far is ${q.largestAftershock}. The gap between the mainshock and its largest aftershock is ${q.bathGap}; across many sequences that gap averages about 1.2 (Båth's law).`,
    `The catalogue is complete here from ${q.completeness}. The b-value, which measures how quickly larger earthquakes become rarer, is ${q.bValue}. The aftershock rate's decay exponent (Omori-Utsu) is ${q.omori}.`,
  ];
}

/** Definitions the model may use when answering questions about one earthquake. */
export const EVENT_GLOSSARY = [
  "Magnitude: a logarithmic measure of an earthquake's size; each whole step is about 32 times more energy released.",
  "Moment magnitude (Mw): computed from the area of the fault that slipped and how far it slipped; the standard for larger earthquakes.",
  "Body-wave magnitude (mb): measured from the first seismic waves; used for quick estimates, and it underestimates large earthquakes.",
  "Depth: shallow earthquakes are less than 70 km deep, intermediate-depth ones 70 to 300 km, deep ones more than 300 km; deep ones occur inside subducting plates.",
  "Subduction zone: where one tectonic plate slides beneath another; most of the largest earthquakes occur there.",
  "Aftershocks: smaller earthquakes that follow a larger one in the same area, as the crust adjusts; their rate falls off with time (Omori-Utsu law).",
  "Epicentre: the point on the surface above where the rupture started; the hypocenter is the starting point itself, at depth.",
  "Reviewed: a seismologist has checked the automatic solution; automatic solutions are revised more often.",
  "b-value: describes how quickly larger earthquakes become rarer than smaller ones; worldwide it is close to 1.",
  "Completeness magnitude: the smallest magnitude above which the catalogue records every earthquake in an area.",
  "Båth's law: across many sequences, the largest aftershock is on average about 1.2 magnitude units smaller than the mainshock.",
];
