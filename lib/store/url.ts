import type { BBox, EventFilter } from "../events/types";
import { clampRate, clampT } from "./time";

export interface ViewState {
  filter: EventFilter;
  t: number;
  rate: number;
  view: "globe" | "map" | "table";
  camera: { lon: number; lat: number; altitude: number } | null;
  selectedId: string | null;
}

const VIEWS = ["globe", "map", "table"] as const;
const DEFAULT_DAYS = 7;
const DEFAULT_MIN_MAGNITUDE = 4.5; // spec §4: the catalogue starts at M4.5+
const MAX_SELECTED_ID = 128;
const MIN_EPOCH = Date.UTC(1900, 0, 1);
const MAX_EPOCH = Date.UTC(2100, 0, 1);

export const DEFAULT_MIN_MAG = DEFAULT_MIN_MAGNITUDE;

export function defaultViewState(now: number = Date.now()): ViewState {
  const range = { startMs: now - DEFAULT_DAYS * 86_400_000, endMs: now };
  return {
    filter: {
      range,
      minMagnitude: DEFAULT_MIN_MAGNITUDE,
      maxMagnitude: null,
      minDepthKm: null,
      maxDepthKm: null,
      bbox: null,
    },
    t: range.endMs,
    rate: 1,
    view: "globe",
    camera: null,
    selectedId: null,
  };
}

function finite(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const clampLat = (v: number) => Math.min(90, Math.max(-90, v));
const clampLon = (v: number) => Math.min(180, Math.max(-180, v));

export function encodeViewState(v: ViewState): string {
  const q = new URLSearchParams();

  if (v.filter.minMagnitude !== DEFAULT_MIN_MAGNITUDE) {
    q.set("minmag", String(v.filter.minMagnitude));
  }
  if (v.filter.maxMagnitude !== null) q.set("maxmag", String(v.filter.maxMagnitude));
  if (v.filter.minDepthKm !== null) q.set("mindepth", String(v.filter.minDepthKm));
  if (v.filter.maxDepthKm !== null) q.set("maxdepth", String(v.filter.maxDepthKm));
  q.set("from", String(v.filter.range.startMs));
  q.set("to", String(v.filter.range.endMs));
  if (v.filter.bbox) {
    const b = v.filter.bbox;
    q.set("bbox", [b.west, b.south, b.east, b.north].map((n) => n.toFixed(4)).join(","));
  }
  // t is omitted when it sits at the range end, which is the default.
  if (v.t !== v.filter.range.endMs) q.set("t", String(v.t));
  if (v.rate !== 1) q.set("rate", String(v.rate));
  if (v.view !== "globe") q.set("view", v.view);
  if (v.camera) {
    q.set(
      "cam",
      [v.camera.lon, v.camera.lat, v.camera.altitude].map((n) => n.toFixed(4)).join(","),
    );
  }
  if (v.selectedId) q.set("sel", v.selectedId);
  return q.toString();
}

/**
 * Total: every input yields a usable state. A shared URL that restores to a
 * blank screen or a frozen clock is a broken feature, and the query string is
 * attacker-controlled input.
 */
export function decodeViewState(qs: string, now: number = Date.now()): ViewState {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(qs.startsWith("?") ? qs.slice(1) : qs);
  } catch {
    q = new URLSearchParams();
  }

  const defaults = defaultViewState(now);

  let startMs = finite(q.get("from")) ?? defaults.filter.range.startMs;
  let endMs = finite(q.get("to")) ?? defaults.filter.range.endMs;
  if (startMs < MIN_EPOCH || startMs > MAX_EPOCH) startMs = defaults.filter.range.startMs;
  if (endMs < MIN_EPOCH || endMs > MAX_EPOCH) endMs = defaults.filter.range.endMs;
  if (endMs <= startMs) {
    startMs = defaults.filter.range.startMs;
    endMs = defaults.filter.range.endMs;
  }
  const range = { startMs, endMs };

  const minMagRaw = finite(q.get("minmag"));
  const minMagnitude =
    minMagRaw !== null && minMagRaw >= -2 && minMagRaw <= 10
      ? minMagRaw
      : DEFAULT_MIN_MAGNITUDE;

  const maxMagRaw = finite(q.get("maxmag"));
  const maxMagnitude =
    maxMagRaw !== null && maxMagRaw >= minMagnitude && maxMagRaw <= 10 ? maxMagRaw : null;

  const minDepthRaw = finite(q.get("mindepth"));
  const maxDepthRaw = finite(q.get("maxdepth"));
  // -20 km is below any reported negative depth; 1000 km is below the deepest
  // recorded hypocentre.
  const minDepthKm =
    minDepthRaw !== null && minDepthRaw >= -20 && minDepthRaw <= 1000 ? minDepthRaw : null;
  const maxDepthKm =
    maxDepthRaw !== null &&
    maxDepthRaw <= 1000 &&
    maxDepthRaw >= -20 &&
    (minDepthKm === null || maxDepthRaw >= minDepthKm)
      ? maxDepthRaw
      : null;

  let bbox: BBox | null = null;
  const bboxRaw = q.get("bbox");
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [west, south, east, north] = parts as [number, number, number, number];
      const s = clampLat(south);
      const n = clampLat(north);
      if (n > s) bbox = { west: clampLon(west), east: clampLon(east), south: s, north: n };
    }
  }

  const filter: EventFilter = {
    range,
    minMagnitude,
    maxMagnitude,
    minDepthKm,
    maxDepthKm,
    bbox,
  };

  const viewRaw = q.get("view");
  const view = (VIEWS as readonly string[]).includes(viewRaw ?? "")
    ? (viewRaw as ViewState["view"])
    : "globe";

  let camera: ViewState["camera"] = null;
  const camRaw = q.get("cam");
  if (camRaw) {
    const parts = camRaw.split(",").map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      const [lon, lat, altitude] = parts as [number, number, number];
      camera = {
        lon: clampLon(lon),
        lat: clampLat(lat),
        altitude: Math.min(50, Math.max(1.05, altitude)),
      };
    }
  }

  const selRaw = q.get("sel");
  const selectedId =
    selRaw !== null && selRaw.length <= MAX_SELECTED_ID && /^[a-z]+:[A-Za-z0-9_-]+$/.test(selRaw)
      ? selRaw
      : null;

  return {
    filter,
    t: clampT(finite(q.get("t")) ?? endMs, range),
    rate: clampRate(finite(q.get("rate")) ?? 1),
    view,
    camera,
    selectedId,
  };
}
