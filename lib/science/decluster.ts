import { greatCircleKm, hypocentralKm } from "./distance";

export interface CatalogEvent {
  id: string;
  time: number;
  lat: number;
  lon: number;
  depthKm: number | null;
  magnitude: number;
}

export interface Cluster {
  mainshockId: string;
  memberIds: string[];
  method: "gardner-knopoff" | "zaliapin-nn";
}

export interface DeclusterResult {
  clusters: Cluster[];
  independentIds: string[];
  method: Cluster["method"];
}

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;

/**
 * Gardner & Knopoff (1974) space-time windows, in the form tabulated by
 * Uhrhammer (1986) and reproduced throughout the declustering literature:
 *
 *   L(M) = 10^(0.1238·M + 0.983)   km
 *   T(M) = 10^(0.032·M + 2.7389)   days,  M ≥ 6.5
 *   T(M) = 10^(0.5409·M − 0.547)   days,  M < 6.5
 *
 * The time window is discontinuous at M 6.5 in the original tabulation; that is
 * a property of the published method, not a transcription error.
 */
export function gardnerKnopoffWindow(magnitude: number): { radiusKm: number; days: number } {
  const radiusKm = 10 ** (0.1238 * magnitude + 0.983);
  const days =
    magnitude >= 6.5
      ? 10 ** (0.032 * magnitude + 2.7389)
      : 10 ** (0.5409 * magnitude - 0.547);
  return { radiusKm, days };
}

export function declusterGardnerKnopoff(events: CatalogEvent[]): DeclusterResult {
  const method = "gardner-knopoff" as const;
  if (events.length === 0) return { clusters: [], independentIds: [], method };

  // Largest first, ties broken by time, so a sequence is always claimed by its
  // largest event regardless of catalogue order.
  const byMagnitude = [...events].sort(
    (a, b) => b.magnitude - a.magnitude || a.time - b.time,
  );
  const claimed = new Set<string>();
  const clusters: Cluster[] = [];

  for (const candidate of byMagnitude) {
    if (claimed.has(candidate.id)) continue;
    const { radiusKm, days } = gardnerKnopoffWindow(candidate.magnitude);
    const windowMs = days * DAY_MS;

    const members = [candidate.id];
    claimed.add(candidate.id);

    for (const other of events) {
      if (claimed.has(other.id)) continue;
      // The window is symmetric in time: foreshocks belong to their mainshock.
      if (Math.abs(other.time - candidate.time) > windowMs) continue;
      if (greatCircleKm(candidate.lat, candidate.lon, other.lat, other.lon) > radiusKm) continue;
      members.push(other.id);
      claimed.add(other.id);
    }

    if (members.length > 1) clusters.push({ mainshockId: candidate.id, memberIds: members, method });
    else claimed.delete(candidate.id); // a lone event is independent, not a cluster
  }

  const inCluster = new Set(clusters.flatMap((c) => c.memberIds));
  return {
    clusters,
    independentIds: events.filter((e) => !inCluster.has(e.id)).map((e) => e.id),
    method,
  };
}

export interface NearestNeighbourOptions {
  /** Gutenberg-Richter b; 1.0 is the global default. */
  b?: number;
  /** Fractal dimension of the hypocentre distribution; 1.6 is Zaliapin's. */
  d?: number;
  /** Split of the magnitude weighting between time and distance. */
  q?: number;
}

/**
 * Zaliapin & Ben-Zion (2013) nearest-neighbour distance in rescaled time-space:
 *
 *   T = t · 10^(−q·b·M_parent)       rescaled time, t in years
 *   R = r^d · 10^(−(1−q)·b·M_parent) rescaled distance, r in km
 *   η = T · R
 *
 * Small η means the pair is close in rescaled space and the child is plausibly
 * triggered; large η means the pair looks like background seismicity.
 */
export function nearestNeighbourDistance(
  parent: CatalogEvent,
  child: CatalogEvent,
  opts: NearestNeighbourOptions = {},
): { eta: number; rescaledTime: number; rescaledDistance: number } | null {
  // Strictly before: two events in the same second are a real pair that
  // rounding made simultaneous, and must still be able to link.
  if (child.time < parent.time) return null;

  const b = opts.b ?? 1.0;
  const d = opts.d ?? 1.6;
  const q = opts.q ?? 0.5;

  // A catalogue rounds times to the second and positions to ~10 m. A pair that
  // rounds to t = 0 or r = 0 is real; floors keep η finite and positive instead
  // of collapsing the statistic to zero.
  const MIN_YEARS = 1 / (365.25 * 86_400); // one second
  const MIN_KM = 0.01;

  const years = Math.max(MIN_YEARS, (child.time - parent.time) / YEAR_MS);
  const km = Math.max(MIN_KM, hypocentralKm(parent, child));

  const rescaledTime = years * 10 ** (-q * b * parent.magnitude);
  const rescaledDistance = km ** d * 10 ** (-(1 - q) * b * parent.magnitude);
  return { eta: rescaledTime * rescaledDistance, rescaledTime, rescaledDistance };
}

export interface ZaliapinOptions extends NearestNeighbourOptions {
  /** Pairs with η below this are triggered. The bimodal η distribution has its
   *  trough near 10^-5 for typical regional catalogues; Zaliapin fits it per
   *  catalogue, which Phase 2 does not attempt. */
  etaThreshold?: number;
}

export function declusterZaliapin(
  events: CatalogEvent[],
  opts: ZaliapinOptions = {},
): DeclusterResult {
  const method = "zaliapin-nn" as const;
  const threshold = opts.etaThreshold ?? 1e-5;
  if (events.length === 0) return { clusters: [], independentIds: [], method };

  const sorted = [...events].sort((a, b) => a.time - b.time);
  /** For each event, its nearest neighbour among all preceding events. */
  const parentOf = new Map<string, string>();

  for (let i = 0; i < sorted.length; i++) {
    const child = sorted[i]!;
    let bestEta = Infinity;
    let bestParent: string | null = null;
    for (let j = 0; j < i; j++) {
      const parent = sorted[j]!;
      const nn = nearestNeighbourDistance(parent, child, opts);
      if (nn === null) continue;
      if (nn.eta < bestEta) {
        bestEta = nn.eta;
        bestParent = parent.id;
      }
    }
    if (bestParent !== null && bestEta < threshold) parentOf.set(child.id, bestParent);
  }

  // Follow parent links to their root; every event sharing a root is one cluster.
  const rootOf = new Map<string, string>();
  const findRoot = (id: string): string => {
    const cached = rootOf.get(id);
    if (cached !== undefined) return cached;
    const parent = parentOf.get(id);
    const root = parent === undefined ? id : findRoot(parent);
    rootOf.set(id, root);
    return root;
  };

  const byRoot = new Map<string, string[]>();
  for (const e of sorted) {
    const root = findRoot(e.id);
    const list = byRoot.get(root) ?? [];
    list.push(e.id);
    byRoot.set(root, list);
  }

  const magnitudeOf = new Map(events.map((e) => [e.id, e.magnitude] as const));
  const clusters: Cluster[] = [];
  const independentIds: string[] = [];

  for (const [, memberIds] of byRoot) {
    if (memberIds.length === 1) {
      independentIds.push(memberIds[0]!);
      continue;
    }
    // The mainshock is the largest member, which need not be the root: a
    // foreshock can be the root of the link tree.
    const mainshockId = memberIds.reduce((best, id) =>
      (magnitudeOf.get(id) ?? -Infinity) > (magnitudeOf.get(best) ?? -Infinity) ? id : best,
    );
    clusters.push({ mainshockId, memberIds, method });
  }

  return { clusters, independentIds, method };
}
