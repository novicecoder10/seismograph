import { buildFdsnUrl, parseMiniSeed, type Trace } from "./miniseed";
import { findNearestStations, type StationWithDistance } from "./stations";

const RSHAKE_DATASELECT = "https://data.raspberryshake.org/fdsnws/dataselect/1/query";

export interface NearestTrace {
  station: StationWithDistance;
  trace: Trace;
}

export type NearestTraceResult =
  | { kind: "ok"; value: NearestTrace }
  | { kind: "none"; why: string }
  | { kind: "error"; why: string };

export interface FindTraceOptions {
  fetchImpl?: typeof fetch;
  dataselectUrl?: string;
  stationBaseUrl?: string;
  maxRadiusDeg?: number;
  /** How many of the nearest stations to try before giving up. */
  attempts?: number;
  preSeconds?: number;
  postSeconds?: number;
  onProgress?(what: string): void;
}

/**
 * The nearest open citizen seismometer with usable data for a time window.
 *
 * Tries several stations in turn: a station can be listed as open and still have
 * no data for this window, and one dead station must not cost the whole panel.
 */
export async function findNearestTrace(
  lat: number,
  lon: number,
  timeMs: number,
  opts: FindTraceOptions = {},
): Promise<NearestTraceResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxRadiusDeg = opts.maxRadiusDeg ?? 3;
  const attempts = opts.attempts ?? 4;

  let stations: StationWithDistance[];
  try {
    opts.onProgress?.("finding a station");
    stations = await findNearestStations(lat, lon, {
      fetchImpl: doFetch,
      baseUrl: opts.stationBaseUrl,
      maxRadiusDeg,
      limit: attempts,
      atMs: timeMs,
    });
  } catch (e) {
    return { kind: "error", why: `station service: ${e}` };
  }

  if (stations.length === 0) {
    return {
      kind: "none",
      why: `No open citizen seismometer within ${maxRadiusDeg}° of the epicentre.`,
    };
  }

  for (const station of stations) {
    opts.onProgress?.(`fetching ${station.network}.${station.station}`);
    try {
      const url = buildFdsnUrl({
        base: opts.dataselectUrl ?? RSHAKE_DATASELECT,
        net: station.network,
        sta: station.station,
        loc: "00",
        cha: "EHZ",
        start: new Date(timeMs - (opts.preSeconds ?? 30) * 1000),
        end: new Date(timeMs + (opts.postSeconds ?? 270) * 1000),
      });
      const res = await doFetch(url);
      if (!res.ok) continue;
      const trace = parseMiniSeed(await res.arrayBuffer())[0];
      // A handful of samples is a truncated record, not a usable trace.
      if (trace === undefined || trace.samples.length < 100) continue;
      return { kind: "ok", value: { station, trace } };
    } catch {
      // Try the next station rather than failing the whole panel.
    }
  }

  return {
    kind: "none",
    why: `No data from the ${stations.length} nearest stations for this window.`,
  };
}
