import { rotateToNorthEast } from "./dsp";
import { buildFdsnUrl, parseMiniSeed, type Trace } from "./miniseed";
import { greatCircleKm } from "../science/distance";

export const EARTHSCOPE_STATION = "https://service.earthscope.org/fdsnws/station/1/query";
export const EARTHSCOPE_DATASELECT = "https://service.earthscope.org/fdsnws/dataselect/1/query";
export const RSHAKE_STATION = "https://data.raspberryshake.org/fdsnws/station/1/query";
export const RSHAKE_DATASELECT = "https://data.raspberryshake.org/fdsnws/dataselect/1/query";

export interface ChannelInfo {
  code: string;
  azimuth: number;
  dip: number;
  sampleRate: number;
}

export interface NetworkStation {
  network: string;
  station: string;
  location: string;
  lat: number;
  lon: number;
  channels: ChannelInfo[];
  source: "gsn" | "rshake";
}

const KM_PER_DEG = 111.19492664455873;

/** FDSN `format=text&level=channel`, grouped to one location code per station
 *  (00 preferred, then blank, then the lowest), keeping channels open at `atMs`. */
export function parseChannelText(body: string, source: NetworkStation["source"], atMs: number): NetworkStation[] {
  const byKey = new Map<string, NetworkStation>();
  for (const line of body.split("\n")) {
    const row = line.trim();
    if (row === "" || row.startsWith("#")) continue;
    const p = row.split("|").map((s) => s.trim());
    if (p.length < 17) continue;
    const [net, sta, loc, cha] = p as [string, string, string, string];
    const lat = Number(p[4]), lon = Number(p[5]), azimuth = Number(p[8]), dip = Number(p[9]), sampleRate = Number(p[14]);
    if (![lat, lon, azimuth, dip, sampleRate].every(Number.isFinite)) continue;
    const start = Date.parse(`${p[15]}Z`);
    const end = p[16] ? Date.parse(`${p[16]}Z`) : Infinity;
    if (!(start <= atMs && atMs <= end)) continue;
    const key = `${net}.${sta}.${loc}`;
    const s = byKey.get(key) ?? { network: net, station: sta, location: loc, lat, lon, channels: [], source };
    if (!s.channels.some((c) => c.code === cha)) s.channels.push({ code: cha, azimuth, dip, sampleRate });
    byKey.set(key, s);
  }
  const rank = (loc: string) => (loc === "00" ? 0 : loc === "" ? 1 : 2);
  const best = new Map<string, NetworkStation>();
  for (const s of byKey.values()) {
    const k = `${s.network}.${s.station}`;
    const cur = best.get(k);
    const better = !cur || rank(s.location) < rank(cur.location) || (rank(s.location) === rank(cur.location) && s.location < cur.location);
    if (better) best.set(k, s);
  }
  return [...best.values()];
}

/** Epicentral distance in degrees. */
export function distanceDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return greatCircleKm(lat1, lon1, lat2, lon2) / KM_PER_DEG;
}

/** Azimuth from the epicentre to the station, degrees clockwise from north. */
export function azimuthDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

export interface SectionStation extends NetworkStation {
  distanceDeg: number;
  azimuthDeg: number;
}

/** Three components present: one vertical and two horizontals. */
export function isThreeComponent(s: NetworkStation): boolean {
  const v = s.channels.filter((c) => Math.abs(c.dip) > 60).length;
  const h = s.channels.filter((c) => Math.abs(c.dip) < 30).length;
  return v >= 1 && h >= 2;
}

/**
 * Stations for a record section: the nearest few Raspberry Shakes, then one
 * broadband station per distance band out to 180°, closest to the band's centre,
 * three-component stations first. The spread in distance is what makes the
 * phases visible as curves.
 */
export function selectRecordSection(
  epi: { lat: number; lon: number },
  stations: NetworkStation[],
  opts: { bandDeg?: number; nearestShakes?: number; maxShakeDeg?: number } = {},
): SectionStation[] {
  const band = opts.bandDeg ?? 10;
  const withDist = stations.map((s) => ({
    ...s,
    distanceDeg: distanceDeg(epi.lat, epi.lon, s.lat, s.lon),
    azimuthDeg: azimuthDeg(epi.lat, epi.lon, s.lat, s.lon),
  }));
  const shakes = withDist
    .filter((s) => s.source === "rshake" && s.distanceDeg <= (opts.maxShakeDeg ?? 10) && s.channels.some((c) => c.code.endsWith("Z")))
    .sort((a, b) => a.distanceDeg - b.distanceDeg)
    .slice(0, opts.nearestShakes ?? 3);
  const picked: SectionStation[] = [...shakes];
  for (let lo = 0; lo < 180; lo += band) {
    const centre = lo + band / 2;
    const candidates = withDist.filter((s) => s.source === "gsn" && s.distanceDeg >= lo && s.distanceDeg < lo + band);
    candidates.sort((a, b) => Number(isThreeComponent(b)) - Number(isThreeComponent(a)) || Math.abs(a.distanceDeg - centre) - Math.abs(b.distanceDeg - centre));
    if (candidates[0]) picked.push(candidates[0]);
  }
  return picked.sort((a, b) => a.distanceDeg - b.distanceDeg);
}

async function text(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url);
  if (res.status === 204 || res.status === 404) return "";
  if (!res.ok) throw new Error(`station service ${res.status}`);
  return res.text();
}

/** GSN broadband stations operating at the event time, worldwide. */
export async function fetchGsnStations(atMs: number, fetchImpl: typeof fetch = fetch): Promise<NetworkStation[]> {
  const iso = new Date(atMs).toISOString().slice(0, 19);
  const q = new URLSearchParams({ network: "IU,II", channel: "BH?", level: "channel", format: "text", starttime: iso, endtime: iso, nodata: "404" });
  return parseChannelText(await text(`${EARTHSCOPE_STATION}?${q}`, fetchImpl), "gsn", atMs);
}

/** Raspberry Shakes within `radiusDeg` of the epicentre. */
export async function fetchNearbyShakes(lat: number, lon: number, atMs: number, radiusDeg = 10, fetchImpl: typeof fetch = fetch): Promise<NetworkStation[]> {
  const q = new URLSearchParams({ network: "AM", channel: "EH?", level: "channel", format: "text", latitude: String(lat), longitude: String(lon), maxradius: String(radiusDeg), nodata: "404" });
  return parseChannelText(await text(`${RSHAKE_STATION}?${q}`, fetchImpl), "rshake", atMs);
}

export interface ThreeComponent {
  station: SectionStation;
  startMs: number;
  sampleRate: number;
  z: Float32Array;
  north: Float32Array | null;
  east: Float32Array | null;
}

/** Align traces on a common start and length (same rate assumed). */
function align(traces: Trace[]): { startMs: number; arrays: Float32Array[] } {
  const rate = traces[0]!.sampleRate;
  const start = Math.max(...traces.map((t) => t.startTime.getTime()));
  const offs = traces.map((t) => Math.round(((start - t.startTime.getTime()) / 1000) * rate));
  const len = Math.min(...traces.map((t, i) => t.samples.length - offs[i]!));
  return { startMs: start, arrays: traces.map((t, i) => t.samples.slice(offs[i]!, offs[i]! + Math.max(0, len))) };
}

export function assembleThreeComponent(station: SectionStation, traces: Trace[]): ThreeComponent | null {
  const find = (pred: (c: ChannelInfo) => boolean) => {
    const info = station.channels.find(pred);
    const tr = info && traces.find((t) => t.channel === info.code && t.samples.length > 0);
    return info && tr ? { info, tr } : null;
  };
  const z = find((c) => Math.abs(c.dip) > 60);
  if (!z) return null;
  const hs = station.channels.filter((c) => Math.abs(c.dip) < 30).map((info) => ({ info, tr: traces.find((t) => t.channel === info.code && t.samples.length > 0) })).filter((h): h is { info: ChannelInfo; tr: Trace } => !!h.tr);
  const usable = [z.tr, ...hs.slice(0, 2).map((h) => h.tr)].filter((t) => t.sampleRate === z.tr.sampleRate);
  const { startMs, arrays } = align(usable);
  let north: Float32Array | null = null, east: Float32Array | null = null;
  if (arrays.length === 3) {
    const r = rotateToNorthEastSafe(arrays[1]!, hs[0]!.info.azimuth, arrays[2]!, hs[1]!.info.azimuth);
    north = r.north; east = r.east;
  }
  return { station, startMs, sampleRate: z.tr.sampleRate, z: arrays[0]!, north, east };
}

function rotateToNorthEastSafe(h1: Float32Array, a1: number, h2: Float32Array, a2: number) {
  // Gaps are NaN in parsed traces; rotation must not spread them.
  const clean = (x: Float32Array) => x.map((v) => (Number.isNaN(v) ? 0 : v));
  return rotateToNorthEast(clean(h1), a1, clean(h2), a2);
}

/** Fetch one station's components for [startMs, endMs]. Null when no data. */
export async function fetchThreeComponent(station: SectionStation, startMs: number, endMs: number, fetchImpl: typeof fetch = fetch): Promise<ThreeComponent | null> {
  const base = station.source === "gsn" ? EARTHSCOPE_DATASELECT : RSHAKE_DATASELECT;
  const url = buildFdsnUrl({
    base, net: station.network, sta: station.station, loc: station.location || "--",
    cha: station.channels.map((c) => c.code).join(","), start: new Date(startMs), end: new Date(endMs),
  });
  const res = await fetchImpl(url);
  if (!res.ok) return null;
  const traces = parseMiniSeed(await res.arrayBuffer());
  return traces.length ? assembleThreeComponent(station, traces) : null;
}
