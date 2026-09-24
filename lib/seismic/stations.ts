/**
 * Station discovery. Phase 0 established that station codes cannot be guessed:
 * data.raspberryshake.org answers 404 "no metadata found" for an invented code
 * and had a 502 outage during the spike. The station service is the only way to
 * find a live station near an event, and it is CORS-open.
 */
export interface Station {
  network: string;
  station: string;
  lat: number;
  lon: number;
  elevationM: number | null;
  siteName: string;
  startMs: number | null;
  /** Null means the station is still operating. */
  endMs: number | null;
}

export interface StationWithDistance extends Station {
  distanceKm: number;
}

import { greatCircleKm } from "../science/distance";

export { greatCircleKm };

const RSHAKE_STATION =
  "https://data.raspberryshake.org/fdsnws/station/1/query";


function parseTime(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const t = Date.parse(`${v}Z`);
  return Number.isFinite(t) ? t : null;
}

/** Parses the FDSN `format=text&level=station` response: a `#`-prefixed header
 *  line followed by pipe-delimited rows. */
export function parseStationText(body: string): Station[] {
  const out: Station[] = [];
  for (const line of body.split("\n")) {
    const row = line.trim();
    if (row === "" || row.startsWith("#")) continue;
    const parts = row.split("|");
    if (parts.length < 6) continue;
    const lat = Number(parts[2]);
    const lon = Number(parts[3]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const elevation = Number(parts[4]);
    out.push({
      network: parts[0]!,
      station: parts[1]!,
      lat,
      lon,
      elevationM: Number.isFinite(elevation) ? elevation : null,
      // A blank site name is common; it is not a reason to drop the station.
      siteName: (parts[5] ?? "").trim(),
      startMs: parseTime(parts[6]),
      endMs: parseTime(parts[7]),
    });
  }
  return out;
}

export interface FindStationsOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Search radius in degrees. */
  maxRadiusDeg?: number;
  limit?: number;
  /** Stations that had closed before this instant are excluded. */
  atMs?: number;
}

export async function findNearestStations(
  lat: number,
  lon: number,
  opts: FindStationsOptions = {},
): Promise<StationWithDistance[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? RSHAKE_STATION;
  const q = new URLSearchParams({
    network: "AM",
    channel: "EHZ",
    format: "text",
    level: "station",
    latitude: String(lat),
    longitude: String(lon),
    maxradius: String(opts.maxRadiusDeg ?? 5),
    nodata: "404",
  });

  const res = await doFetch(`${base}?${q}`);
  // 404 means no station matched, which is an ordinary answer for most of the
  // ocean, not an error.
  if (res.status === 404 || res.status === 204) return [];
  if (!res.ok) throw new Error(`station service ${res.status}`);

  const atMs = opts.atMs ?? Date.now();
  return parseStationText(await res.text())
    .filter((s) => s.endMs === null || s.endMs >= atMs)
    .map((s) => ({ ...s, distanceKm: greatCircleKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, opts.limit ?? 5);
}
