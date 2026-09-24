// miniSEED fetch and parse. Ported from the Phase 0 spike with its tests.
//
// seisplotjs is TypeScript-native and decompresses STEIM1/2. Two findings from
// the spike, both recorded in FINDINGS.md:
//   1. seisplotjs 3.2.7 cannot be imported under plain Node — its barrel entry
//      (and even its `nodeonly` entry) evaluates `class X extends HTMLElement`
//      at module scope. Tests must run in a DOM environment.
//   2. The API is `miniseed.seismogramPerChannel(records)`, not `merge`.
import { miniseed } from "seisplotjs";

export interface Trace {
  network: string;
  station: string;
  location: string;
  channel: string;
  startTime: Date;
  sampleRate: number; // Hz
  samples: Float32Array; // counts; gaps between segments are NaN
}

export function buildFdsnUrl(o: {
  base: string;
  net: string;
  sta: string;
  loc: string;
  cha: string;
  start: Date;
  end: Date;
}): string {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "");
  const q = new URLSearchParams({
    network: o.net,
    station: o.sta,
    location: o.loc,
    channel: o.cha,
    starttime: iso(o.start),
    endtime: iso(o.end),
    nodata: "404",
  });
  return `${o.base}?${q}`;
}

function toDate(t: unknown): Date {
  if (t instanceof Date) return t;
  const asLuxon = t as { toJSDate?: () => Date };
  if (typeof asLuxon?.toJSDate === "function") return asLuxon.toJSDate();
  return new Date(String(t));
}

export function parseMiniSeed(buf: ArrayBuffer): Trace[] {
  if (buf.byteLength < 64) throw new Error("buffer too short to be miniSEED");

  let records: unknown[];
  try {
    records = miniseed.parseDataRecords(buf) as unknown[];
  } catch (cause) {
    throw new Error("not parseable as miniSEED", { cause });
  }
  if (!records || records.length === 0) throw new Error("no miniSEED data records found");

  const seismograms = miniseed.seismogramPerChannel(records as never) as never[];

  return seismograms.map((seis) => {
    const s = seis as unknown as {
      networkCode: string;
      stationCode: string;
      locationCode: string;
      channelCode: string;
      sampleRate: number;
      startTime: unknown;
      segments: { startTime: unknown; y: ArrayLike<number> }[];
    };
    const startTime = toDate(s.startTime);
    const rate = s.sampleRate;

    // One segment per contiguous run. Place each at its true sample offset from
    // the seismogram start so a dropped packet becomes NaN, not a time shift.
    const segments = s.segments ?? [];
    let span = 0;
    for (const seg of segments) {
      const offset = Math.round(
        ((toDate(seg.startTime).getTime() - startTime.getTime()) / 1000) * rate,
      );
      span = Math.max(span, offset + seg.y.length);
    }
    const samples = new Float32Array(span).fill(NaN);
    for (const seg of segments) {
      const offset = Math.round(
        ((toDate(seg.startTime).getTime() - startTime.getTime()) / 1000) * rate,
      );
      for (let i = 0; i < seg.y.length; i++) {
        const v = seg.y[i];
        if (v !== undefined) samples[offset + i] = v;
      }
    }

    return {
      network: s.networkCode,
      station: s.stationCode,
      location: s.locationCode ?? "",
      channel: s.channelCode,
      startTime,
      sampleRate: rate,
      samples,
    };
  });
}
