// @vitest-environment happy-dom
// seisplotjs 3.2.7 touches HTMLElement at import time, so these tests need a DOM.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFdsnUrl, parseMiniSeed } from "./miniseed";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name = "rshake-R0066-EHZ.mseed") => {
  const b = readFileSync(join(HERE, "..", "..", "test", "fixtures", name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("buildFdsnUrl", () => {
  it("builds an FDSN dataselect query with ISO times", () => {
    const url = buildFdsnUrl({
      base: "https://data.raspberryshake.org/fdsnws/dataselect/1/query",
      net: "AM",
      sta: "R0066",
      loc: "00",
      cha: "EHZ",
      start: new Date("2026-09-20T00:00:00Z"),
      end: new Date("2026-09-20T00:05:00Z"),
    });
    expect(url).toContain("network=AM");
    expect(url).toContain("station=R0066");
    expect(url).toContain("starttime=2026-09-20T00%3A00%3A00");
    expect(url).toContain("nodata=404");
  });
});

describe("parseMiniSeed", () => {
  it("decodes the Raspberry Shake fixture into a 100 Hz trace", () => {
    const traces = parseMiniSeed(fixture());
    expect(traces.length).toBeGreaterThan(0);
    const t = traces[0]!;
    console.log(
      `${t.network}.${t.station}.${t.location}.${t.channel} ${t.sampleRate}Hz ` +
        `n=${t.samples.length} start=${t.startTime.toISOString()}`,
    );
    expect(t.network).toBe("AM");
    expect(t.channel).toBe("EHZ");
    expect(t.sampleRate).toBe(100);
    expect(t.samples.length).toBeGreaterThan(10_000);
    expect(t.startTime.getUTCFullYear()).toBe(2026);
  });

  it("decodes a 40 Hz broadband channel from a different network", () => {
    const t = parseMiniSeed(fixture("iu-anmo-bhz.mseed"))[0]!;
    console.log(`${t.network}.${t.station}.${t.channel} ${t.sampleRate}Hz n=${t.samples.length}`);
    expect(t.network).toBe("IU");
    expect(t.sampleRate).toBe(40);
  });

  it("produces samples that are not all identical", () => {
    const s = parseMiniSeed(fixture())[0]!.samples;
    const finite = Array.from(s).filter(Number.isFinite);
    expect(new Set(finite.slice(0, 500)).size).toBeGreaterThan(5);
  });

  it("rejects a non-miniSEED buffer rather than returning garbage", () => {
    const junk = new TextEncoder().encode("not a seed file at all, really not it").buffer;
    expect(() => parseMiniSeed(junk as ArrayBuffer)).toThrow();
  });

  it("rejects a buffer too short to be a record", () => {
    expect(() => parseMiniSeed(new ArrayBuffer(8))).toThrow(/too short/);
  });
});
