import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findNearestStations, greatCircleKm, parseStationText } from "./stations";

const fixture = readFileSync("test/fixtures/rshake-stations.txt", "utf8");

describe("greatCircleKm", () => {
  it("is zero for a point against itself", () => {
    expect(greatCircleKm(35.7, -117.6, 35.7, -117.6)).toBeCloseTo(0, 6);
  });

  it("gives about 111 km per degree of latitude", () => {
    expect(greatCircleKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });

  it("knows a degree of longitude shrinks toward the pole", () => {
    const atEquator = greatCircleKm(0, 0, 0, 1);
    const atSixty = greatCircleKm(60, 0, 60, 1);
    expect(atSixty).toBeLessThan(atEquator * 0.55);
  });

  it("measures across the antimeridian by the short way", () => {
    expect(greatCircleKm(0, 179.5, 0, -179.5)).toBeLessThan(120);
  });
});

describe("parseStationText", () => {
  const stations = parseStationText(fixture);

  it("skips the header and parses every row", () => {
    expect(stations.length).toBeGreaterThan(1000);
    expect(stations.every((s) => s.network === "AM")).toBe(true);
  });

  it("parses coordinates as numbers", () => {
    const s = stations[0]!;
    expect(Math.abs(s.lat)).toBeLessThanOrEqual(90);
    expect(Math.abs(s.lon)).toBeLessThanOrEqual(180);
  });

  it("records a closed station's end time and leaves an open one null", () => {
    expect(stations.some((s) => s.endMs !== null)).toBe(true);
    expect(stations.some((s) => s.endMs === null)).toBe(true);
  });

  it("keeps a station with a blank site name rather than dropping it", () => {
    const withBlank = parseStationText(
      "#Network|Station|Latitude|Longitude|Elevation|SiteName|StartTime|EndTime\n" +
        "AM|RTEST|10.0|20.0|5.0||2020-01-01T00:00:00|",
    );
    expect(withBlank).toHaveLength(1);
    expect(withBlank[0]!.siteName).toBe("");
  });

  it("skips malformed rows instead of producing NaN coordinates", () => {
    const mixed = parseStationText(
      "#header\nAM|BAD|notalat|notalon|0|x|2020-01-01T00:00:00|\n" +
        "AM|GOOD|1.0|2.0|0|x|2020-01-01T00:00:00|\n" +
        "too|few|fields\n",
    );
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.station).toBe("GOOD");
  });

  it("returns nothing for an empty body", () => {
    expect(parseStationText("")).toHaveLength(0);
  });
});

describe("findNearestStations", () => {
  const repo = (body = fixture, status = 200) =>
    findNearestStations(34.0, -118.2, {
      fetchImpl: async () => new Response(body, { status }),
      atMs: Date.UTC(2026, 8, 24),
      limit: 3,
    });

  it("returns the closest stations in ascending distance", async () => {
    const found = await repo();
    expect(found).toHaveLength(3);
    const distances = found.map((s) => s.distanceKm);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    // Los Angeles has Raspberry Shakes within a few tens of km.
    expect(distances[0]).toBeLessThan(80);
  });

  it("excludes stations that had already closed", async () => {
    const found = await findNearestStations(34.0, -118.2, {
      fetchImpl: async () => new Response(fixture, { status: 200 }),
      atMs: Date.UTC(2026, 8, 24),
      limit: 50,
    });
    for (const s of found) expect(s.endMs === null || s.endMs >= Date.UTC(2026, 8, 24)).toBe(true);
  });

  it("treats 404 as no station nearby, which is normal for most of the ocean", async () => {
    expect(await repo("", 404)).toHaveLength(0);
  });

  it("throws on a server error so the caller can say the service is down", async () => {
    await expect(repo("boom", 503)).rejects.toThrow(/503/);
  });

  it("sends latitude, longitude and maxradius", async () => {
    let seen = "";
    await findNearestStations(34.0, -118.2, {
      fetchImpl: async (input) => {
        seen = String(input);
        return new Response("", { status: 404 });
      },
      maxRadiusDeg: 2,
    });
    expect(seen).toContain("latitude=34");
    expect(seen).toContain("longitude=-118.2");
    expect(seen).toContain("maxradius=2");
    expect(seen).toContain("format=text");
  });
});
