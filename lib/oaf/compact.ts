/**
 * Decoder for OpenSHA's CompactEqkRupList, the packing USGS uses for the catalogue
 * inside an `oaf` product's forecast_data.json. Layout from
 * opensha-oaf/src/main/java/org/opensha/oaf/rj/CompactEqkRupList.java (CC0).
 *
 * The packed values exceed 2^53, so they must never pass through JSON.parse as
 * numbers: `decodeCatalog` reads the two arrays from the raw text with BigInt.
 */

export interface CompactEvent {
  time: number;
  magnitude: number;
  lat: number;
  lon: number;
  depthKm: number;
}

const TIME_MASK = 0x3fffffffffffn;
const TIME_OFFSET = 0x200000000000n;

export function decodeMagTime(v: bigint): { time: number; magnitude: number } {
  const magnitude = Number((v & 0x7fffn) - 0x4000n) / 1000;
  const time = Number(((v >> 15n) & TIME_MASK) - TIME_OFFSET);
  return { time, magnitude };
}

export function decodeLatLonDepth(v: bigint): { lat: number; lon: number; depthKm: number } {
  return {
    lat: Number((v & 0x1fffffn) - 0x100000n) / 1e4,
    lon: Number(((v >> 21n) & 0x7fffffn) - 0x400000n) / 1e4,
    depthKm: Number(((v >> 44n) & 0x1ffffn) - 0x4000n) / 100,
  };
}

function rawArray(text: string, key: string): bigint[] {
  const m = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`).exec(text);
  if (!m) throw new Error(`forecast_data.json has no ${key}`);
  const body = m[1]!.trim();
  return body === "" ? [] : body.split(",").map((s) => BigInt(s.trim()));
}

/** Decode the `catalog` block of a forecast_data.json given as raw text. */
export function decodeCatalog(text: string): CompactEvent[] {
  const magTime = rawArray(text, "mag_time_list");
  const lld = rawArray(text, "lat_lon_depth_list");
  if (magTime.length !== lld.length) {
    throw new Error(`catalogue lists differ in length: ${magTime.length} vs ${lld.length}`);
  }
  return magTime.map((mt, i) => ({ ...decodeMagTime(mt), ...decodeLatLonDepth(lld[i]!) }));
}
