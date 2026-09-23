import { eventKey, isEvent, type Event } from "../types";
import { emptyReport, epochMs, features, num, type NormalizeReport } from "./report";

/**
 * EMSC ships time in four shapes. The live API 1.6 uses the nested object form
 * with FRACTIONAL seconds; the other three appear in older payloads and in the
 * legacy client this was ported from. All four are pinned by
 * test/fixtures/emsc-shapes.json, per spec §8, which required the existing
 * behaviour be captured before the port rather than after.
 */
function emscTime(p: Record<string, unknown>): number | null {
  const t = p.time;
  if (typeof t === "string") {
    const parsed = Date.parse(t);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof t === "number") {
    const n = num(t);
    if (n !== null) return epochMs(n);
  }
  if (typeof t === "object" && t !== null) {
    const inner = num((t as { time?: unknown }).time);
    if (inner !== null) return epochMs(inner);
  }
  if (typeof p.lastupdate === "string") {
    const parsed = Date.parse(p.lastupdate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Three shapes: a { mag, mag_type } object (live API 1.6), a bare numeric
 *  `mag`, or absent. */
function emscMagnitude(p: Record<string, unknown>): {
  magnitude: number | null;
  magType: string | null;
} {
  const m = p.magnitude;
  if (typeof m === "object" && m !== null) {
    const o = m as { mag?: unknown; mag_type?: unknown; magtype?: unknown };
    const type = o.mag_type ?? o.magtype;
    return {
      magnitude: num(o.mag),
      magType: typeof type === "string" && type !== "" ? type : null,
    };
  }
  const bareType = p.mag_type ?? p.magtype;
  return {
    magnitude: num(p.mag),
    magType: typeof bareType === "string" && bareType !== "" ? bareType : null,
  };
}

function emscPlace(p: Record<string, unknown>): string {
  for (const key of ["flynn_region", "place", "region"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "object" && v !== null) {
      const o = v as { region?: unknown; name?: unknown };
      for (const inner of [o.region, o.name]) {
        if (typeof inner === "string" && inner.trim() !== "") return inner;
      }
    }
  }
  return "Unknown location";
}

function emscTsunami(p: Record<string, unknown>): boolean {
  const t = p.tsunami;
  if (typeof t === "boolean") return t;
  if (typeof t === "number") return t === 1;
  if (typeof t === "object" && t !== null) {
    const type = (t as { type?: unknown }).type;
    // The live feed sends { type: "NONE" } for the overwhelming majority.
    return typeof type === "string" && type !== "" && type.toUpperCase() !== "NONE";
  }
  return false;
}

export function normalizeEmscGeoJson(input: unknown): NormalizeReport {
  const report = emptyReport();

  for (const raw of features(input)) {
    const f = raw as {
      id?: unknown;
      geometry?: { coordinates?: unknown } | null;
      properties?: Record<string, unknown> | null;
    };
    const p = f.properties ?? {};

    let lon: number | null = null;
    let lat: number | null = null;
    let depthKm: number | null = null;

    const coords = f.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      lon = num(coords[0]);
      lat = num(coords[1]);
      if (coords.length > 2) depthKm = num(coords[2]);
    }
    if (lat === null && typeof p.location === "object" && p.location !== null) {
      const loc = p.location as { lat?: unknown; lon?: unknown };
      lat = num(loc.lat);
      lon = num(loc.lon);
    }
    if (depthKm === null && p.depth !== undefined) {
      depthKm =
        typeof p.depth === "object" && p.depth !== null
          ? num((p.depth as { depth?: unknown }).depth)
          : num(p.depth);
    }
    if (lat === null || lon === null) {
      report.rejected.push({ raw, reason: "no usable coordinates" });
      continue;
    }

    const { magnitude, magType } = emscMagnitude(p);
    if (magnitude === null) {
      report.rejected.push({ raw, reason: "no usable magnitude" });
      continue;
    }

    const time = emscTime(p);
    if (time === null) {
      report.rejected.push({ raw, reason: "no usable time" });
      continue;
    }

    // The live API 1.6 uses `evid` and a NUMERIC feature id; older payloads use
    // `unid` or `eventid`.
    const rawId = [f.id, p.evid, p.unid, p.eventid].find(
      (v) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "",
    );
    if (rawId === undefined) {
      report.rejected.push({ raw, reason: "missing event id" });
      continue;
    }

    const event: Event = {
      id: eventKey("emsc", String(rawId)),
      source: "emsc",
      sourceId: String(rawId),
      time,
      lat,
      lon,
      depthKm,
      magnitude,
      magType,
      place: emscPlace(p),
      // EMSC does not publish review status, felt reports or PAGER equivalents
      // in this feed. Absent is recorded as absent, never invented.
      status: "unknown",
      felt: null,
      cdi: null,
      mmi: null,
      alert: null,
      tsunami: emscTsunami(p),
      sig: null,
      url: typeof p.url === "string" ? p.url : null,
    };

    if (!isEvent(event)) {
      report.rejected.push({ raw, reason: "failed the Event guard after mapping" });
      continue;
    }
    report.accepted.push(event);
  }

  return report;
}
