import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detailUrl, parseProducts } from "./products";

const rich = JSON.parse(readFileSync("test/fixtures/usgs-detail-rich.json", "utf8"));
const sparse = JSON.parse(readFileSync("test/fixtures/usgs-detail-sparse.json", "utf8"));

describe("parseProducts on an event with the full tree", () => {
  const p = parseProducts(rich);

  it("reads the origin with its uncertainties", () => {
    const o = p.origins[0]!;
    expect(o.magnitude).toBeCloseTo(6.4, 1);
    expect(o.magnitudeError).toBeGreaterThan(0);
    expect(o.horizontalErrorKm).toBeGreaterThan(0);
    expect(o.azimuthalGapDeg).toBeGreaterThan(0);
    expect(o.depthKm).toBeGreaterThan(0);
  });

  it("reads ShakeMap contours and the finite-fault rupture", () => {
    expect(p.shakemap).not.toBeNull();
    expect(p.shakemap!.contourMmiUrl).toMatch(/cont_mmi\.json$/);
    expect(p.shakemap!.ruptureUrl).toMatch(/rupture\.json$/);
    expect(p.shakemap!.maxMmi).toBeGreaterThan(0);
  });

  it("reads DYFI felt bins and the response count", () => {
    expect(p.dyfi).not.toBeNull();
    expect(p.dyfi!.responses).toBeGreaterThan(0);
    expect(p.dyfi!.geo1kmUrl).toMatch(/dyfi_geo_1km\.geojson$/);
  });

  it("reads PAGER exposure", () => {
    expect(p.pager).not.toBeNull();
    expect(["green", "yellow", "orange", "red"]).toContain(p.pager!.alertLevel);
    expect(p.pager!.exposuresUrl).toMatch(/exposures\.json$/);
  });

  it("reads both nodal planes of the moment tensor", () => {
    const mt = p.momentTensors[0]!;
    expect(mt.planes).not.toBeNull();
    const [a, b] = mt.planes!;
    for (const plane of [a, b]) {
      expect(plane.strike).toBeGreaterThanOrEqual(0);
      expect(plane.dip).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(plane.rake)).toBe(true);
    }
    expect(mt.percentDoubleCouple).toBeGreaterThan(0);
  });

  it("reads the ground-failure alerts", () => {
    expect(p.groundFailure).not.toBeNull();
    expect(p.groundFailure!.landslideAlert).not.toBeNull();
  });
});

describe("parseProducts on an event with almost no products", () => {
  const p = parseProducts(sparse);

  it("still reads the origin", () => {
    expect(p.origins.length).toBeGreaterThan(0);
    expect(p.origins[0]!.magnitude).toBeGreaterThan(0);
  });

  it("returns null for each absent product rather than an empty shell", () => {
    expect(p.shakemap).toBeNull();
    expect(p.dyfi).toBeNull();
    expect(p.pager).toBeNull();
    expect(p.groundFailure).toBeNull();
    expect(p.momentTensors).toHaveLength(0);
  });
});

describe("parseProducts is defensive", () => {
  it("returns empty structures for junk rather than throwing", () => {
    for (const junk of [null, undefined, 42, "x", {}, { properties: {} }]) {
      const p = parseProducts(junk);
      expect(p.origins).toHaveLength(0);
      expect(p.shakemap).toBeNull();
    }
  });

  it("tolerates a product whose contents map lacks the expected key", () => {
    const p = parseProducts({
      properties: {
        products: {
          shakemap: [{ source: "us", properties: { maxmmi: "4" }, contents: {} }],
        },
      },
    });
    expect(p.shakemap).not.toBeNull();
    expect(p.shakemap!.contourMmiUrl).toBeNull();
    expect(p.shakemap!.maxMmi).toBe(4);
  });

  it("drops a half-specified moment tensor rather than inventing a plane", () => {
    const p = parseProducts({
      properties: {
        products: {
          "moment-tensor": [
            {
              source: "us",
              properties: { "nodal-plane-1-strike": "10", "nodal-plane-1-dip": "20" },
            },
          ],
        },
      },
    });
    expect(p.momentTensors[0]!.planes).toBeNull();
  });
});

describe("detailUrl", () => {
  it("builds the detail feed URL and escapes the id", () => {
    expect(detailUrl("us7000tiqc")).toBe(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/us7000tiqc.geojson",
    );
    expect(detailUrl("a/b")).toContain("a%2Fb");
  });
});
