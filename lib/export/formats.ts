import { parquetWriteBuffer } from "hyparquet-writer";
import type { Event, EventFilter } from "../events/types";
import { zip } from "./zip";

/**
 * Catalogue export. Every format carries the same columns, and attribution:
 * USGS data are public domain, EMSC data are CC BY 4.0.
 */
export const COLUMNS = ["id", "time_utc", "latitude", "longitude", "depth_km", "magnitude", "mag_type", "place", "status", "source", "url"] as const;

export const ATTRIBUTION = "Data: USGS ComCat (public domain) and EMSC (CC BY 4.0). Exported from Seismograph, a hobby and research project.";

function row(e: Event): (string | number | null)[] {
  return [e.id, new Date(e.time).toISOString(), e.lat, e.lon, e.depthKm, e.magnitude, e.magType, e.place, e.status, e.source, e.url];
}

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(events: Event[]): string {
  return [COLUMNS.join(","), ...events.map((e) => row(e).map(csvCell).join(","))].join("\r\n") + "\r\n";
}

export function toTsv(events: Event[]): string {
  const cell = (v: string | number | null) => (v === null ? "" : String(v).replace(/[\t\r\n]+/g, " "));
  return [COLUMNS.join("\t"), ...events.map((e) => row(e).map(cell).join("\t"))].join("\n") + "\n";
}

export function toJson(events: Event[], filter?: EventFilter): string {
  return JSON.stringify({ attribution: ATTRIBUTION, generated: new Date().toISOString(), filter: filter ?? null, count: events.length, events }, null, 1);
}

export function toGeoJson(events: Event[]): string {
  return JSON.stringify({
    type: "FeatureCollection",
    metadata: { attribution: ATTRIBUTION, generated: new Date().toISOString(), count: events.length },
    features: events.map((e) => ({
      type: "Feature",
      id: e.id,
      // [lon, lat, depth km] as in the USGS feeds.
      geometry: { type: "Point", coordinates: e.depthKm === null ? [e.lon, e.lat] : [e.lon, e.lat, e.depthKm] },
      properties: { time: e.time, time_utc: new Date(e.time).toISOString(), mag: e.magnitude, magType: e.magType, place: e.place, status: e.status, source: e.source, url: e.url },
    })),
  });
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/** QuakeML resource identifiers allow only a narrow character set: "usgs:us7000abcd"
 *  becomes smi:seismograph/usgs/us7000abcd, and anything else outside it becomes "_". */
const rid = (id: string) => `smi:seismograph/${id.replace(":", "/").replace(/[^\w\-.*()+?~'=,;#/&]/g, "_")}`;

/** QuakeML 1.2 Basic Event Description; depth in metres, as the schema requires. */
export function toQuakeMl(events: Event[]): string {
  const body = events.map((e) => {
    const o = `${rid(e.id)}/origin`, m = `${rid(e.id)}/magnitude`;
    return `    <event publicID="${xml(rid(e.id))}">
      <description><text>${xml(e.place)}</text><type>region name</type></description>
      <origin publicID="${xml(o)}">
        <time><value>${new Date(e.time).toISOString()}</value></time>
        <latitude><value>${e.lat}</value></latitude>
        <longitude><value>${e.lon}</value></longitude>${e.depthKm === null ? "" : `
        <depth><value>${Math.round(e.depthKm * 1000)}</value></depth>`}
        <evaluationStatus>${e.status === "reviewed" ? "reviewed" : "preliminary"}</evaluationStatus>
      </origin>
      <magnitude publicID="${xml(m)}">
        <mag><value>${e.magnitude}</value></mag>${e.magType ? `
        <type>${xml(e.magType)}</type>` : ""}
        <originID>${xml(o)}</originID>
      </magnitude>
      <preferredOriginID>${xml(o)}</preferredOriginID>
      <preferredMagnitudeID>${xml(m)}</preferredMagnitudeID>
      <type>earthquake</type>
    </event>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<q:quakeml xmlns="http://quakeml.org/xmlns/bed/1.2" xmlns:q="http://quakeml.org/xmlns/quakeml/1.2">
  <eventParameters publicID="smi:seismograph/export/${Date.now()}">
    <comment><text>${xml(ATTRIBUTION)}</text></comment>
${body}
  </eventParameters>
</q:quakeml>
`;
}

export function toKml(events: Event[]): string {
  const style = (m: number) => (m >= 7 ? "m7" : m >= 6 ? "m6" : m >= 5 ? "m5" : "m4");
  const styles = [["m4", 0.6, "ff4787ff"], ["m5", 0.9, "ff2659d9"], ["m6", 1.3, "ff1e3fd0"], ["m7", 1.8, "ff1010b0"]]
    .map(([id, scale, color]) => `<Style id="${id}"><IconStyle><color>${color}</color><scale>${scale}</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon></IconStyle></Style>`).join("");
  const marks = events.map((e) => `<Placemark><name>M ${e.magnitude.toFixed(1)}</name><description>${xml(`${e.place} · ${new Date(e.time).toISOString()} · depth ${e.depthKm ?? "unknown"} km`)}</description><TimeStamp><when>${new Date(e.time).toISOString()}</when></TimeStamp><styleUrl>#${style(e.magnitude)}</styleUrl><Point><coordinates>${e.lon},${e.lat},0</coordinates></Point></Placemark>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Seismograph export</name><description>${xml(ATTRIBUTION)}</description>${styles}
${marks}
</Document></kml>
`;
}

export function toKmz(events: Event[]): Uint8Array {
  return zip([{ name: "doc.kml", data: toKml(events) }]);
}

/** A minimal Office Open XML workbook: one sheet, inline strings, numeric cells. */
export function toXlsx(events: Event[]): Uint8Array {
  const col = (i: number) => String.fromCharCode(65 + i);
  const cell = (v: string | number | null, r: number, c: number) => {
    const ref = `${col(c)}${r}`;
    if (v === null) return "";
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  const rows = [COLUMNS as readonly (string | number | null)[], ...events.map(row)]
    .map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, i + 1, c)).join("")}</row>`).join("");
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="earthquakes" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>` },
  ]);
}

export function toParquet(events: Event[]): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: [
      { name: "id", data: events.map((e) => e.id), type: "STRING" },
      { name: "time_utc", data: events.map((e) => new Date(e.time)), type: "TIMESTAMP" },
      { name: "latitude", data: events.map((e) => e.lat), type: "DOUBLE" },
      { name: "longitude", data: events.map((e) => e.lon), type: "DOUBLE" },
      { name: "depth_km", data: events.map((e) => e.depthKm), type: "DOUBLE" },
      { name: "magnitude", data: events.map((e) => e.magnitude), type: "DOUBLE" },
      { name: "mag_type", data: events.map((e) => e.magType), type: "STRING" },
      { name: "place", data: events.map((e) => e.place), type: "STRING" },
      { name: "status", data: events.map((e) => e.status), type: "STRING" },
      { name: "source", data: events.map((e) => e.source), type: "STRING" },
      { name: "url", data: events.map((e) => e.url), type: "STRING" },
    ],
  });
}

/** Python that reproduces the query with ObsPy against the same public service. */
export function obspySnippet(filter: EventFilter): string {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
  const args = [
    `starttime=UTCDateTime("${iso(filter.range.startMs)}")`,
    `endtime=UTCDateTime("${iso(filter.range.endMs)}")`,
    filter.minMagnitude !== null ? `minmagnitude=${filter.minMagnitude}` : null,
    filter.maxMagnitude !== null ? `maxmagnitude=${filter.maxMagnitude}` : null,
    filter.minDepthKm !== null ? `mindepth=${filter.minDepthKm}` : null,
    filter.maxDepthKm !== null ? `maxdepth=${filter.maxDepthKm}` : null,
    filter.bbox ? `minlatitude=${filter.bbox.south}, maxlatitude=${filter.bbox.north}, minlongitude=${filter.bbox.west}, maxlongitude=${filter.bbox.east}` : null,
  ].filter(Boolean);
  return `# The same catalogue query, reproduced with ObsPy (pip install obspy).
from obspy import UTCDateTime
from obspy.clients.fdsn import Client

client = Client("USGS")
catalog = client.get_events(
    ${args.join(",\n    ")},
)
print(catalog)
catalog.plot(projection="global")  # needs cartopy
`;
}

/** Python that fetches the waveforms shown on the waves page for one event. */
export function obspyWaveformSnippet(e: Event, station: { network: string; station: string; location: string; channels: string }): string {
  const t = new Date(e.time).toISOString().slice(0, 19);
  return `# Waveforms for the M ${e.magnitude.toFixed(1)} ${e.place} earthquake, with predicted arrivals (pip install obspy).
from obspy import UTCDateTime
from obspy.clients.fdsn import Client
from obspy.geodetics import locations2degrees
from obspy.taup import TauPyModel

origin = UTCDateTime("${t}")
client = Client("EARTHSCOPE")
st = client.get_waveforms("${station.network}", "${station.station}", "${station.location || "*"}", "${station.channels}", origin - 60, origin + 1800)
inv = client.get_stations(network="${station.network}", station="${station.station}", level="response")
st.remove_response(inventory=inv, output="VEL")
st.filter("bandpass", freqmin=0.02, freqmax=2.0)

sta = inv[0][0]
dist = locations2degrees(${e.lat}, ${e.lon}, sta.latitude, sta.longitude)
for arr in TauPyModel("iasp91").get_travel_times(source_depth_in_km=${e.depthKm ?? 10}, distance_in_degree=dist, phase_list=["P", "S", "PP", "PKP", "ScS"]):
    print(arr.name, round(arr.time, 1), "s")
st.plot()
`;
}
