// @vitest-environment happy-dom
import { parquetReadObjects } from "hyparquet";
import { describe, expect, it } from "vitest";
import type { Event } from "../events/types";
import { obspySnippet, toCsv, toGeoJson, toKmz, toParquet, toQuakeMl, toTsv, toXlsx } from "./formats";
import { crc32, unzipStored, zip } from "./zip";

const ev = (i: number, place: string, depthKm: number | null = 10): Event => ({
  id: `usgs:t${i}`, source: "usgs", sourceId: `t${i}`, time: Date.UTC(2026, 8, 1, 0, i), lat: -20 + i, lon: 170 + i, depthKm,
  magnitude: 4.5 + i / 10, magType: "mb", place, status: "reviewed", felt: null, cdi: null, mmi: null, alert: null, tsunami: false, sig: null, url: `https://x/${i}`,
});
const events = [ev(0, "10 km N of \"Quoted\", Fiji"), ev(1, "line\nbreak, & <tag>"), ev(2, "Tonga", null)];

describe("zip", () => {
  it("has the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("round-trips names and contents", () => {
    const z = zip([{ name: "a.txt", data: "hello" }, { name: "dir/ü.xml", data: "<x/>" }]);
    const m = unzipStored(z);
    expect(new TextDecoder().decode(m.get("a.txt"))).toBe("hello");
    expect(new TextDecoder().decode(m.get("dir/ü.xml"))).toBe("<x/>");
  });
});

describe("formats", () => {
  it("CSV quotes per RFC 4180", () => {
    const lines = toCsv(events).split("\r\n");
    expect(lines[0]).toBe("id,time_utc,latitude,longitude,depth_km,magnitude,mag_type,place,status,source,url");
    expect(lines[1]).toContain('"10 km N of ""Quoted"", Fiji"');
    expect(toCsv(events)).toContain('"line\nbreak, & <tag>"');
  });

  it("TSV never splits a row", () => {
    expect(toTsv(events).trim().split("\n")).toHaveLength(4);
  });

  it("GeoJSON puts longitude first and keeps missing depth missing", () => {
    const g = JSON.parse(toGeoJson(events));
    expect(g.features[0].geometry.coordinates).toEqual([170, -20, 10]);
    expect(g.features[2].geometry.coordinates).toEqual([172, -18]);
  });

  it("QuakeML parses as XML with depth in metres and escaped text", () => {
    const doc = new DOMParser().parseFromString(toQuakeMl(events), "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.getElementsByTagName("event")).toHaveLength(3);
    expect(doc.getElementsByTagName("depth")[0]!.textContent!.trim()).toBe("10000");
    expect(doc.getElementsByTagName("text")[2]!.textContent).toBe("line\nbreak, & <tag>");
  });

  it("QuakeML resource IDs match the schema's ResourceReference pattern", () => {
    // From QuakeML-BED-1.2.xsd; validated once with lxml against the official schema.
    const pattern = /^(smi|quakeml):[\w\d][\w\d\-.*()_~']{2,}\/[\w\d\-.*()_~'][\w\d\-.*()+?_~'=,;#/&]*$/;
    const ids = [...toQuakeMl([...events, { ...events[0]!, id: "emsc:2026 0901+x" }]).matchAll(/publicID="([^"]+)"|<(?:originID|preferredOriginID|preferredMagnitudeID)>([^<]+)</g)].map((m) => m[1] ?? m[2]!);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect(id, id).toMatch(pattern);
  });

  it("KMZ contains a KML document", () => {
    const kml = new TextDecoder().decode(unzipStored(toKmz(events)).get("doc.kml"));
    expect(kml).toContain("<Placemark>");
    expect((kml.match(/<Placemark>/g) ?? []).length).toBe(3);
  });

  it("XLSX holds a header row and one row per event", () => {
    const parts = unzipStored(toXlsx(events));
    const sheet = new TextDecoder().decode(parts.get("xl/worksheets/sheet1.xml"));
    expect((sheet.match(/<row /g) ?? []).length).toBe(4);
    expect(parts.has("[Content_Types].xml")).toBe(true);
  });

  it("Parquet round-trips through an independent reader", async () => {
    const buf = toParquet(events);
    const rows = await parquetReadObjects({ file: buf });
    expect(rows).toHaveLength(3);
    expect(rows[0]!.id).toBe("usgs:t0");
    expect(rows[2]!.depth_km).toBeNull();
    expect(rows[1]!.place).toBe("line\nbreak, & <tag>");
  });

  it("ObsPy snippet carries the filter", () => {
    const s = obspySnippet({ range: { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 1, 1) }, minMagnitude: 5, maxMagnitude: null, minDepthKm: null, maxDepthKm: null, bbox: null });
    expect(s).toContain('starttime=UTCDateTime("2026-01-01T00:00:00")');
    expect(s).toContain("minmagnitude=5");
    expect(s).not.toContain("maxmagnitude");
  });
});
