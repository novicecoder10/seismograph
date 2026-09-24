import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextWholeHour, reproduceUsgs } from "./build";

describe("live reproduction of a published USGS forecast", () => {
  it.each(["ci38457511", "nc75382936", "us7000ti1p", "us7000sq93", "aka2026powmkf"])("%s reproduces within 0.5%%", (id) => {
    const published = JSON.parse(readFileSync(`test/fixtures/oaf/${id}-forecast.json`, "utf8"));
    const r = reproduceUsgs(published, readFileSync(`test/fixtures/oaf/${id}-forecast_data.json`, "utf8"));
    expect(r).not.toBeNull();
    expect(r!.maxRelError).toBeLessThan(0.005);
  });

  it("declines model types it does not implement", () => {
    const published = JSON.parse(readFileSync("test/fixtures/oaf/nc75382936-forecast.json", "utf8"));
    published.model.name = "ETAS";
    expect(reproduceUsgs(published, readFileSync("test/fixtures/oaf/nc75382936-forecast_data.json", "utf8"))).toBeNull();
  });

  it("starts windows at the next whole hour", () => {
    expect(nextWholeHour(Date.UTC(2026, 8, 3, 3, 19, 53))).toBe(Date.UTC(2026, 8, 3, 4));
    expect(nextWholeHour(Date.UTC(2026, 8, 3, 4))).toBe(Date.UTC(2026, 8, 3, 4));
  });
});
