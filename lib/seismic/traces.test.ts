// @vitest-environment happy-dom
// seisplotjs 3.2.7 touches HTMLElement at import time; see spikes/FINDINGS.md §3.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findNearestTrace } from "./traces";

const stationText = readFileSync("test/fixtures/rshake-stations.txt", "utf8");
const mseed = readFileSync("test/fixtures/rshake-R0066-EHZ.mseed");
const mseedBody = mseed.buffer.slice(mseed.byteOffset, mseed.byteOffset + mseed.byteLength);

const LA = { lat: 34.0, lon: -118.2, time: Date.UTC(2026, 8, 20, 0, 0, 0) };

/** Routes station requests and dataselect requests to their fixtures. */
const routed = (dataselect: () => Response): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/station/1/query")) return new Response(stationText, { status: 200 });
    return dataselect();
  }) as typeof fetch;

describe("findNearestTrace", () => {
  it("returns the nearest station with usable data", async () => {
    const r = await findNearestTrace(LA.lat, LA.lon, LA.time, {
      fetchImpl: routed(() => new Response(mseedBody, { status: 200 })),
    });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value.station.network).toBe("AM");
    expect(r.value.trace.sampleRate).toBe(100);
    expect(r.value.station.distanceKm).toBeLessThan(200);
  });

  it("reports progress so the panel can say what it is doing", async () => {
    const seen: string[] = [];
    await findNearestTrace(LA.lat, LA.lon, LA.time, {
      fetchImpl: routed(() => new Response(mseedBody, { status: 200 })),
      onProgress: (w) => seen.push(w),
    });
    expect(seen[0]).toMatch(/finding a station/);
    expect(seen.some((s) => s.startsWith("fetching AM."))).toBe(true);
  });

  it("tries the next station when one has no data, rather than giving up", async () => {
    let call = 0;
    const r = await findNearestTrace(LA.lat, LA.lon, LA.time, {
      fetchImpl: routed(() => {
        call++;
        // The first two stations answer 204; the third has data.
        return call < 3
          ? new Response(null, { status: 204 })
          : new Response(mseedBody, { status: 200 });
      }),
    });
    expect(r.kind).toBe("ok");
    expect(call).toBe(3);
  });

  it("rejects a truncated record rather than drawing a few samples", async () => {
    const tiny = mseedBody.slice(0, 512); // one record, ~200 samples... trimmed below
    const r = await findNearestTrace(LA.lat, LA.lon, LA.time, {
      fetchImpl: routed(() => new Response(tiny.slice(0, 200), { status: 200 })),
      attempts: 2,
    });
    expect(r.kind).toBe("none");
  });

  it("says so plainly when no station is near, which is normal at sea", async () => {
    const r = await findNearestTrace(-30, -140, LA.time, {
      fetchImpl: (async (input: RequestInfo | URL) =>
        String(input).includes("/station/1/query")
          ? new Response("", { status: 404 })
          : new Response(null, { status: 204 })) as typeof fetch,
    });
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.why).toMatch(/No open citizen seismometer/);
  });

  it("distinguishes a station-service outage from an empty ocean", async () => {
    const r = await findNearestTrace(LA.lat, LA.lon, LA.time, {
      fetchImpl: (async () => new Response("boom", { status: 503 })) as typeof fetch,
    });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.why).toMatch(/station service/);
  });

  it("reports none, not error, when every nearby station is silent", async () => {
    const r = await findNearestTrace(LA.lat, LA.lon, LA.time, {
      fetchImpl: routed(() => new Response(null, { status: 204 })),
      attempts: 3,
    });
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.why).toMatch(/No data from the 3 nearest/);
  });
});
