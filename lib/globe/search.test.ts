import { describe, expect, it } from "vitest";
import { EARTH_KM } from "./camera";
import { altitudeFor, parseCoordinates, parseNominatim } from "./search";

describe("parseCoordinates", () => {
  it.each([
    ["35.68, 139.69", { lat: 35.68, lon: 139.69 }],
    ["35.68 139.69", { lat: 35.68, lon: 139.69 }],
    ["33.9S 151.2E", { lat: -33.9, lon: 151.2 }],
    ["-12,-77", { lat: -12, lon: -77 }],
    ["19.4°N, 99.1°W", { lat: 19.4, lon: -99.1 }],
  ])("reads %s", (q, want) => expect(parseCoordinates(q)).toEqual(want));

  it.each(["Tokyo", "95, 10", "10, 190", ""])("rejects %s", (q) => expect(parseCoordinates(q)).toBeNull());
});

describe("search results", () => {
  it("frames a city closer than a country", () => {
    const city = altitudeFor([35.5, 35.9, 139.4, 139.9]);
    const country = altitudeFor([24, 46, 123, 146]);
    expect(city).toBeLessThan(country);
    expect((city - 1) * EARTH_KM).toBeGreaterThan(3);
  });

  it("keeps valid results and drops the rest", () => {
    const r = parseNominatim([
      { display_name: "Tokyo, Japan", lat: "35.68", lon: "139.69", boundingbox: ["35.5", "35.9", "139.4", "139.9"] },
      { display_name: "broken", lat: "x", lon: "1" },
      "nonsense",
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "Tokyo, Japan", lat: 35.68, lon: 139.69 });
    expect(parseNominatim({ error: "x" })).toEqual([]);
  });
});
