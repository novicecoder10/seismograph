import { normalizeUsgsGeoJson } from "../events/normalize/usgs";
import type { BBox, Event, EventFilter } from "../events/types";
import { splitAntimeridian } from "../geo/bbox";
import type { EventPage, EventRepository } from "./events";

const FDSN = "https://earthquake.usgs.gov/fdsnws/event/1/query";

export interface UsgsFdsnOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

function isoNoMs(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "");
}

function buildQuery(
  filter: EventFilter,
  limit: number,
  offset: number,
  bbox: BBox | null,
): URLSearchParams {
  const q = new URLSearchParams({
    format: "geojson",
    starttime: isoNoMs(filter.range.startMs),
    endtime: isoNoMs(filter.range.endMs),
    minmagnitude: String(filter.minMagnitude),
    orderby: "time",
    limit: String(limit),
    // FDSN offset is 1-based.
    offset: String(offset + 1),
  });
  if (filter.maxMagnitude !== null) q.set("maxmagnitude", String(filter.maxMagnitude));
  if (filter.minDepthKm !== null) q.set("mindepth", String(filter.minDepthKm));
  if (filter.maxDepthKm !== null) q.set("maxdepth", String(filter.maxDepthKm));
  if (bbox) {
    q.set("minlatitude", String(bbox.south));
    q.set("maxlatitude", String(bbox.north));
    q.set("minlongitude", String(bbox.west));
    q.set("maxlongitude", String(bbox.east));
  }
  return q;
}

export function createUsgsFdsnRepository(opts: UsgsFdsnOptions = {}): EventRepository {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? FDSN;

  return {
    name: "usgs-fdsn",

    async query(filter, o = {}): Promise<EventPage> {
      const limit = Math.min(o.limit ?? 500, 20_000);
      const offset = o.cursor ? Number(o.cursor) : 0;
      // An antimeridian-crossing box becomes two FDSN queries: the service
      // rejects a west bound greater than its east bound.
      const boxes = filter.bbox ? splitAntimeridian(filter.bbox) : [null];

      const events: Event[] = [];
      for (const bbox of boxes) {
        const url = `${base}?${buildQuery(filter, limit, offset, bbox)}`;
        const res = await doFetch(url);
        // 204 and 404 both mean "nothing matched" in FDSN, not an error.
        if (res.status === 204 || res.status === 404) continue;
        if (!res.ok) throw new Error(`FDSN ${res.status} for ${url}`);
        events.push(...normalizeUsgsGeoJson(await res.json()).accepted);
      }

      events.sort((a, b) => b.time - a.time);
      const sliced = events.slice(0, limit);
      return {
        events: sliced,
        cursor: sliced.length === limit ? String(offset + limit) : null,
        total: null,
      };
    },

    async byId(id): Promise<Event | null> {
      const [source, sourceId] = id.split(":", 2);
      if (source !== "usgs" || !sourceId) return null;
      const url = `${base}?format=geojson&eventid=${encodeURIComponent(sourceId)}`;
      const res = await doFetch(url);
      // FDSN answers 400 for a syntactically invalid event id.
      if (res.status === 204 || res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`FDSN ${res.status} for ${url}`);
      const body = (await res.json()) as { type?: string };
      // A single-event query returns a bare Feature, not a FeatureCollection.
      const collection =
        body?.type === "FeatureCollection"
          ? body
          : { type: "FeatureCollection", features: [body] };
      return normalizeUsgsGeoJson(collection).accepted[0] ?? null;
    },
  };
}
