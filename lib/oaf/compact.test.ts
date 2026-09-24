import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeCatalog, decodeMagTime } from "./compact";

const text = readFileSync("test/fixtures/oaf/ci38457511-forecast_data.json", "utf8");

describe("CompactEqkRupList decoding", () => {
  it("decodes the whole Ridgecrest catalogue USGS fitted", () => {
    const cat = decodeCatalog(text);
    const results = JSON.parse(text).results;
    expect(cat).toHaveLength(3617);
    expect(cat).toHaveLength(results.catalog_eqk_count);
    const mags = cat.map((e) => e.magnitude);
    expect(Math.min(...mags)).toBe(2.45);
    expect(Math.max(...mags)).toBe(results.catalog_max_mag);
    for (const e of cat) {
      expect(e.time).toBeGreaterThanOrEqual(results.catalog_start_time);
      expect(e.time).toBeLessThanOrEqual(results.catalog_end_time);
    }
  });

  it("decodes the first entry exactly", () => {
    expect(decodeCatalog(text)[0]).toEqual({
      time: 1787557904630, magnitude: 2.71, lat: 36.0667, lon: -117.8435, depthKm: 2.31,
    });
  });

  it("keeps precision that JSON.parse would lose", () => {
    const v = 1211496202025781910n;
    expect(Number.isSafeInteger(Number(v))).toBe(false);
    expect(decodeMagTime(v)).toEqual({ time: 1787557904630, magnitude: 2.71 });
  });

  it("decodes an empty catalogue", () => {
    expect(decodeCatalog('{"lat_lon_depth_list": [], "mag_time_list": []}')).toEqual([]);
  });
});
