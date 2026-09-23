export interface BBox {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface Event {
  /** Source-prefixed and stable: "usgs:us7000abcd". */
  id: string;
  source: "usgs" | "emsc";
  sourceId: string;
  /** Milliseconds since the epoch, UTC. Non-nullable: an event without a time
   *  cannot be placed on the application's primary axis. */
  time: number;
  lat: number;
  lon: number;
  /** Nullable: a located event may have unconstrained depth. May be NEGATIVE:
   *  USGS reports events above sea level with a negative depth. */
  depthKm: number | null;
  /** Non-nullable: an event without a magnitude cannot be scaled or filtered,
   *  and every consumer would need a null branch. Such records are rejected at
   *  normalization, with a reason, rather than carried as half-events. */
  magnitude: number;
  magType: string | null;
  place: string;
  status: "automatic" | "reviewed" | "unknown";
  felt: number | null;
  cdi: number | null;
  mmi: number | null;
  alert: "green" | "yellow" | "orange" | "red" | null;
  tsunami: boolean;
  sig: number | null;
  /** The canonical agency page for this event. */
  url: string | null;
}

export interface EventFilter {
  range: TimeRange;
  minMagnitude: number;
  maxMagnitude: number | null;
  minDepthKm: number | null;
  maxDepthKm: number | null;
  bbox: BBox | null;
}

export function eventKey(source: Event["source"], sourceId: string): string {
  const id = sourceId.trim();
  if (id === "") throw new Error(`empty source id for source ${source}`);
  return `${source}:${id}`;
}

export function isEvent(v: unknown): v is Event {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  const nullableNum = (x: unknown) => x === null || num(x);

  return (
    typeof e.id === "string" &&
    (e.source === "usgs" || e.source === "emsc") &&
    typeof e.sourceId === "string" &&
    num(e.time) &&
    num(e.lat) &&
    e.lat >= -90 &&
    e.lat <= 90 &&
    num(e.lon) &&
    e.lon >= -180 &&
    e.lon <= 180 &&
    nullableNum(e.depthKm) &&
    num(e.magnitude) &&
    typeof e.place === "string" &&
    typeof e.tsunami === "boolean"
  );
}
