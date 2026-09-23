import { eventKey, isEvent, type Event } from "../types";
import { emptyReport, epochMs, features, num, type NormalizeReport } from "./report";

const ALERTS = new Set(["green", "yellow", "orange", "red"]);

function status(v: unknown): Event["status"] {
  return v === "reviewed" || v === "automatic" ? v : "unknown";
}

export function normalizeUsgsGeoJson(input: unknown): NormalizeReport {
  const report = emptyReport();

  for (const raw of features(input)) {
    const f = raw as {
      id?: unknown;
      geometry?: { coordinates?: unknown } | null;
      properties?: Record<string, unknown> | null;
    };
    const p = f.properties ?? {};

    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      report.rejected.push({ raw, reason: "no geometry coordinates" });
      continue;
    }
    const lon = num(coords[0]);
    const lat = num(coords[1]);
    // A null third element is a real USGS value: depth was not constrained.
    const depthKm = coords.length > 2 ? num(coords[2]) : null;
    if (lon === null || lat === null) {
      report.rejected.push({ raw, reason: "non-numeric coordinates" });
      continue;
    }

    const magnitude = num(p.mag);
    if (magnitude === null) {
      report.rejected.push({ raw, reason: "null or non-numeric magnitude" });
      continue;
    }

    const t = num(p.time);
    if (t === null) {
      report.rejected.push({ raw, reason: "null or non-numeric time" });
      continue;
    }

    const sourceId = typeof f.id === "string" && f.id.trim() !== "" ? f.id : null;
    if (sourceId === null) {
      report.rejected.push({ raw, reason: "missing event id" });
      continue;
    }

    const alert =
      typeof p.alert === "string" && ALERTS.has(p.alert) ? (p.alert as Event["alert"]) : null;

    const event: Event = {
      id: eventKey("usgs", sourceId),
      source: "usgs",
      sourceId,
      time: epochMs(t),
      lat,
      lon,
      depthKm,
      magnitude,
      magType: typeof p.magType === "string" ? p.magType : null,
      place: typeof p.place === "string" && p.place !== "" ? p.place : "Unknown location",
      status: status(p.status),
      felt: num(p.felt),
      cdi: num(p.cdi),
      mmi: num(p.mmi),
      alert,
      tsunami: p.tsunami === 1 || p.tsunami === true,
      sig: num(p.sig),
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
