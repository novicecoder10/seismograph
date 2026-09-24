import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERIC_RJ, regimeAt } from "./regimes";

const surveyed: { id: string; lat: number; lon: number; regime: string }[] =
  JSON.parse(readFileSync("test/fixtures/oaf/regimes.json", "utf8")).events;

describe("tectonic regime lookup", () => {
  it.each(surveyed.map((e) => [e.id, e] as const))("%s gets the regime USGS assigned", (_, e) => {
    expect(regimeAt(e.lat, e.lon).strec).toBe(e.regime);
  });

  it("agrees with the generic parameters USGS used in every Bayesian fixture", () => {
    for (const f of readdirSync("test/fixtures/oaf").filter((n) => n.endsWith("-forecast_data.json"))) {
      const fd = JSON.parse(readFileSync(`test/fixtures/oaf/${f}`, "utf8"));
      if (fd.parameters.generic_regime.startsWith("CAL-")) continue;
      const { strec, code } = regimeAt(fd.mainshock.mainshock_lat, fd.mainshock.mainshock_lon);
      expect(strec, f).toBe(fd.parameters.generic_regime);
      const g = fd.parameters.generic_params;
      expect(GENERIC_RJ[code]).toMatchObject({ aMean: g.aValue_mean, aSigma1: g.aValue_sigma1, p: g.pValue, c: g.cValue });
    }
  });

  it("resolves either side of the antimeridian and at the poles", () => {
    for (const [lat, lon] of [[-20, 179.99], [-20, -179.99], [51, 180], [51, -180], [90, 0], [-90, 0], [10, 540]]) {
      expect(regimeAt(lat!, lon!).code).toMatch(/^[A-Z]+-[A-Z]+$/);
    }
  });
});
