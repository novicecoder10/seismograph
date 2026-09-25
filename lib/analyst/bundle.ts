import { featuresAt, rankSimilar, whatHappenedNext, type Features, type LibrarySequence } from "./features";

/**
 * The frozen evidence bundle: the only thing the explainer's prose may draw on.
 * Every number is a display string, formatted here, so neither the template nor
 * the model ever formats or computes.
 */

/** Fixed lexicon (spec §6): bands map to phrases in code; the model never chooses. */
export function productivityPhrase(delta: number): string {
  if (delta >= 0.75) return "far more productive than most of the past sequences";
  if (delta >= 0.25) return "more productive than most of the past sequences";
  if (delta > -0.25) return "about as productive as the typical past sequence";
  if (delta > -0.75) return "less productive than most of the past sequences";
  return "far less productive than most of the past sequences";
}

export function directionPhrase(target: number, other: number): "more productive than" | "less productive than" | "about as productive as" {
  const d = target - other;
  if (d >= 0.15) return "more productive than";
  if (d <= -0.15) return "less productive than";
  return "about as productive as";
}

export function elapsedPhrase(days: number): string {
  if (days < 1) {
    const h = Math.max(1, Math.round(days * 24));
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  if (days < 60) {
    const d = Math.round(days);
    return d === 1 ? "1 day" : `${d} days`;
  }
  const m = Math.round(days / 30.44);
  return `${m} months`;
}

const mag = (m: number) => `M ${m.toFixed(1)}`;
const count = (n: number) => String(n);
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const year = (ms: number) => String(new Date(ms).getUTCFullYear());

export interface Comparison {
  key: string;
  name: string;
  year: string;
  mag: string;
  direction: ReturnType<typeof directionPhrase>;
  largestSoFar: string;
  next: { count: string; largest: string; when: string; largerFollowed: boolean };
}

export interface Bundle {
  v: 1;
  target: {
    id: string;
    mag: string;
    date: string;
    place: string;
    elapsed: string;
    count: string;
    largest: string;
    foreshocks: string;
    productivity: string;
  };
  most: Comparison[];
  least: Comparison[];
  base: { libraryCount: string; largerFollowedCount: string };
  provenance: { catalogue: string; floor: string; radius: string; computedAt: string };
  caveats: string[];
  /** Refuse to narrate when the evidence is thin; the page says why. */
  limited: string | null;
}

export interface TargetSequence {
  id: string;
  mag: number;
  time: number;
  place: string;
  radiusKm: number;
  events: [number, number, number | null][];
}

function comparison(m: ReturnType<typeof rankSimilar>[number], target: Features): Comparison {
  const n = m.next;
  return {
    key: m.seq.id,
    name: m.seq.name,
    year: year(m.seq.time),
    mag: mag(m.seq.mag),
    direction: directionPhrase(target.productivity, m.features.productivity),
    largestSoFar: m.features.largest === null ? "none above M 4.5" : mag(m.features.largest),
    next: {
      count: count(n.count),
      largest: n.largest ? mag(n.largest.mag) : "none above M 4.5",
      when: n.largest ? `${elapsedPhrase(n.largest.days)} after its mainshock` : "",
      largerFollowed: n.largerFollowed,
    },
  };
}

export function buildBundle(target: TargetSequence, library: LibrarySequence[], nowMs: number): Bundle {
  const elapsedDays = Math.max(1 / 24, (nowMs - target.time) / 86_400_000);
  const T = Math.min(elapsedDays, 364);
  const f = featuresAt(target.mag, target.events, T);
  const ranked = rankSimilar({ id: target.id, mag: target.mag, features: f }, library);
  const prods = ranked.map((r) => r.features.productivity).sort((a, b) => a - b);
  const median = prods[Math.floor(prods.length / 2)] ?? f.productivity;
  const others = library.filter((s) => s.id !== target.id);
  const largerAfter = others.filter((s) => whatHappenedNext(s.mag, s.events, T).largerFollowed).length;

  let limited: string | null = null;
  if (elapsedDays > 364) limited = "This sequence is more than a year old, beyond the span the past sequences are compared over.";
  else if (target.mag < 6) limited = "Comparisons are made for mainshocks of M 6.0 and above: below that, too few aftershocks reach M 4.5, the size the global catalogue records completely, to compare sequences meaningfully.";

  return {
    v: 1,
    target: {
      id: target.id,
      mag: mag(target.mag),
      date: date(target.time),
      place: target.place,
      elapsed: elapsedPhrase(T),
      count: count(f.count),
      largest: f.largest === null ? "none above M 4.5" : mag(f.largest),
      foreshocks: count(f.foreshocks),
      productivity: productivityPhrase(f.productivity - median),
    },
    most: ranked.slice(0, 3).map((m) => comparison(m, f)),
    least: ranked.slice(-2).reverse().map((m) => comparison(m, f)),
    base: { libraryCount: count(others.length), largerFollowedCount: count(largerAfter) },
    provenance: {
      catalogue: "USGS ComCat",
      floor: "M 4.5",
      radius: `${Math.round(target.radiusKm)} km`,
      computedAt: new Date(nowMs).toISOString().slice(0, 16).replace("T", " ") + " UTC",
    },
    caveats: [
      "The comparison uses only the number and size of M 4.5 and larger aftershocks so far, and whether there were foreshocks. It knows nothing of fault geometry, depth or tectonic setting, each of which shaped the past sequences.",
      "Smaller aftershocks are not counted, because the global catalogue does not record them completely.",
      "What followed in past sequences describes those sequences. It is not a statement about the future of this one.",
    ],
    limited,
  };
}

/** Every string in the bundle, for the verifier's whitelist and vocabulary. */
export function bundleStrings(b: Bundle): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(b);
  return out;
}
