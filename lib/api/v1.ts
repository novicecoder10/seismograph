import type { Event, EventFilter } from "../events/types";
import type { ForecastResult } from "../repositories/forecast";
import type { SequenceAnalysis } from "../science/sequence";

/**
 * The public API, v1. Everything here is pure: the route handlers do the I/O
 * and call these to parse queries and shape responses. Parameter names follow
 * the FDSN event service, so a query moves between this and USGS unchanged.
 */

export const API_VERSION = "1";
export const DEFAULT_LIMIT = 1000;
export const MAX_LIMIT = 20_000;
export const DEFAULT_DAYS = 7;
export const MIN_MAGNITUDE_FLOOR = 4.5;

export const FORMATS = ["json", "geojson", "csv", "tsv", "quakeml", "kml"] as const;
export type ApiFormat = (typeof FORMATS)[number];

export const CONTENT_TYPE: Record<ApiFormat, string> = {
  json: "application/json; charset=utf-8",
  geojson: "application/geo+json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  quakeml: "application/xml; charset=utf-8",
  kml: "application/vnd.google-earth.kml+xml; charset=utf-8",
};

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

export interface EventQuery {
  filter: EventFilter;
  limit: number;
  offset: number;
  format: ApiFormat;
}

function time(v: string | null, name: string): number | null | string {
  if (v === null || v === "") return null;
  const n = /^-?\d+$/.test(v) ? Number(v) : Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) || v.length <= 10 ? v : `${v}Z`);
  return Number.isFinite(n) ? n : `${name} must be an ISO 8601 time or epoch milliseconds`;
}

function num(v: string | null, name: string, lo: number, hi: number): number | null | string {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : `${name} must be a number in [${lo}, ${hi}]`;
}

/** Parses an FDSN-style event query. Returns an error sentence, never throws. */
export function parseEventQuery(params: URLSearchParams, now: number): EventQuery | { error: string } {
  const fields = {
    start: time(params.get("starttime"), "starttime"),
    end: time(params.get("endtime"), "endtime"),
    minmag: num(params.get("minmagnitude"), "minmagnitude", -2, 10),
    maxmag: num(params.get("maxmagnitude"), "maxmagnitude", -2, 10),
    mindepth: num(params.get("mindepth"), "mindepth", -10, 800),
    maxdepth: num(params.get("maxdepth"), "maxdepth", -10, 800),
    minlat: num(params.get("minlatitude"), "minlatitude", -90, 90),
    maxlat: num(params.get("maxlatitude"), "maxlatitude", -90, 90),
    minlon: num(params.get("minlongitude"), "minlongitude", -360, 360),
    maxlon: num(params.get("maxlongitude"), "maxlongitude", -360, 360),
    limit: num(params.get("limit"), "limit", 1, MAX_LIMIT),
    offset: num(params.get("offset"), "offset", 0, 1e7),
  };
  for (const v of Object.values(fields)) if (typeof v === "string") return { error: v };
  const f = fields as { [K in keyof typeof fields]: number | null };

  const format = (params.get("format") ?? "json").toLowerCase();
  if (!(FORMATS as readonly string[]).includes(format)) return { error: `format must be one of ${FORMATS.join(", ")}` };

  const endMs = f.end ?? now;
  const startMs = f.start ?? endMs - DEFAULT_DAYS * 86_400_000;
  if (startMs >= endMs) return { error: "starttime must be before endtime" };

  const box = [f.minlat, f.maxlat, f.minlon, f.maxlon];
  if (box.some((v) => v !== null) && box.some((v) => v === null)) {
    return { error: "a bounding box needs all four of minlatitude, maxlatitude, minlongitude, maxlongitude" };
  }
  if (f.minlat !== null && f.maxlat !== null && f.minlat >= f.maxlat) return { error: "minlatitude must be below maxlatitude" };

  return {
    filter: {
      range: { startMs, endMs },
      // The catalogue this project serves starts at M4.5 worldwide.
      minMagnitude: Math.max(MIN_MAGNITUDE_FLOOR, f.minmag ?? MIN_MAGNITUDE_FLOOR),
      maxMagnitude: f.maxmag,
      minDepthKm: f.mindepth,
      maxDepthKm: f.maxdepth,
      bbox: f.minlat === null ? null : { south: f.minlat, north: f.maxlat!, west: f.minlon!, east: f.maxlon! },
    },
    limit: Math.round(f.limit ?? DEFAULT_LIMIT),
    offset: Math.round(f.offset ?? 0),
    format: format as ApiFormat,
  };
}

/** The headline of a sequence analysis: no per-event arrays beyond the catalogue itself. */
export function sequenceSummary(a: SequenceAnalysis, truncated: boolean) {
  return {
    mainshock: a.mainshock,
    window: a.window,
    truncated,
    counts: { events: a.events.length, aftershocks: a.aftershocks.length },
    classification: a.classification,
    completeness: a.mc,
    bValue: a.bValue,
    omori: a.omori,
    etas: a.ogata,
    declustering: {
      gardnerKnopoff: { ...a.declustering.gardnerKnopoff, memberIds: undefined },
      zaliapin: { ...a.declustering.zaliapin, memberIds: undefined },
      agreement: a.declustering.agreement,
    },
    aftershockIds: a.aftershocks.map((e) => e.id),
  };
}

/** A forecast result without the posterior grid's typed arrays. */
export function forecastBody(r: ForecastResult) {
  if (r.kind === "usgs") {
    return { kind: r.kind, event: r.event, source: "USGS aftershock forecast (published)", forecast: r.published, reproduction: r.reproduction, reproductionNote: r.reproductionNote, productUpdated: r.productUpdatedMs };
  }
  if (r.kind === "refused") return { kind: r.kind, event: r.event, reason: r.reason };
  const { posterior: p } = r;
  return {
    kind: r.kind,
    event: r.event,
    source: "Seismograph reproduction of the USGS Reasenberg-Jones method",
    forecast: r.forecast,
    baseline: r.baseline,
    regime: r.regime,
    searchRadiusKm: r.searchRadiusKm,
    centroid: r.centroid,
    truncated: r.truncated,
    posterior: { b: p.b, magMain: p.magMain, mean: p.mean, sd: p.sd, n: p.n, edgeMass: p.edgeMass },
  };
}

export function eventLinks(e: Pick<Event, "id">, origin: string) {
  const id = encodeURIComponent(e.id);
  return {
    page: `${origin}/event/${id}`,
    sequence: `${origin}/api/v1/sequence/${id}`,
    forecast: `${origin}/api/v1/forecast/${id}`,
  };
}
