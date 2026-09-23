import { normalizeUsgsGeoJson } from "../events/normalize/usgs";
import type { Event, EventFilter, TimeRange } from "../events/types";
import { bboxContains } from "../geo/bbox";
import type { EventPage, EventRepository } from "./events";

const FEEDS = {
  hour: "all_hour",
  day: "all_day",
  week: "all_week",
  month: "all_month",
} as const;

const BASE = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary";

const WINDOW_MS = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
} as const;

export type FeedName = keyof typeof FEEDS;

export interface UsgsFeedOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
}

/** The smallest feed that covers the requested range, or null when the range
 *  reaches further back than any feed does. */
export function chooseFeed(range: TimeRange, now: number): FeedName | null {
  const age = now - range.startMs;
  for (const key of ["hour", "day", "week", "month"] as const) {
    if (age <= WINDOW_MS[key]) return key;
  }
  return null;
}

export function createUsgsFeedRepository(opts: UsgsFeedOptions = {}): EventRepository {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? BASE;
  const now = opts.now ?? Date.now;

  function matches(e: Event, f: EventFilter): boolean {
    if (e.time < f.range.startMs || e.time > f.range.endMs) return false;
    if (e.magnitude < f.minMagnitude) return false;
    if (f.maxMagnitude !== null && e.magnitude > f.maxMagnitude) return false;
    // A depth filter excludes unknown depths: "between 0 and 70 km" is a claim
    // about a known depth, and null is not a depth of zero.
    if (f.minDepthKm !== null && (e.depthKm === null || e.depthKm < f.minDepthKm)) return false;
    if (f.maxDepthKm !== null && (e.depthKm === null || e.depthKm > f.maxDepthKm)) return false;
    if (f.bbox && !bboxContains(f.bbox, e.lat, e.lon)) return false;
    return true;
  }

  return {
    name: "usgs-feed",

    async query(filter, o = {}): Promise<EventPage> {
      const feed = chooseFeed(filter.range, now());
      if (feed === null) {
        // Outside every feed window. Returning empty rather than silently
        // serving the wrong window; the caller picks the FDSN repository.
        return { events: [], cursor: null, total: null };
      }
      const res = await doFetch(`${base}/${FEEDS[feed]}.geojson`);
      if (!res.ok) throw new Error(`USGS feed ${res.status} for ${FEEDS[feed]}`);
      const events = normalizeUsgsGeoJson(await res.json()).accepted.filter((e) =>
        matches(e, filter),
      );
      events.sort((a, b) => b.time - a.time);
      const limit = o.limit ?? 500;
      return { events: events.slice(0, limit), cursor: null, total: events.length };
    },

    async byId(id): Promise<Event | null> {
      if (!id.startsWith("usgs:")) return null;
      const res = await doFetch(`${base}/${FEEDS.month}.geojson`);
      if (!res.ok) return null;
      return normalizeUsgsGeoJson(await res.json()).accepted.find((e) => e.id === id) ?? null;
    },
  };
}
