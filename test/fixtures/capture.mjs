/** Captures live feed payloads as committed fixtures, so tests never depend on
 *  the network or on current seismicity (spec §8).
 *  Run manually:  node test/fixtures/capture.mjs
 *  Re-run only to deliberately refresh; the committed fixtures are the contract. */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const SOURCES = {
  "usgs-all-hour.json":
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
  "usgs-significant-month.json":
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson",
  "usgs-fdsn-m45-week.json":
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=4.5" +
    "&starttime=2026-09-15&endtime=2026-09-22&orderby=time",
  "emsc-recent.json":
    "https://www.emsc-csem.org/service/api/1.6/get.geojson?format=geojson" +
    "&min_mag=0&limit=200&orderby=time",
};

for (const [name, url] of Object.entries(SOURCES)) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) {
      console.error(`${name}: HTTP ${res.status} — skipped`);
      continue;
    }
    const body = await res.json();
    writeFileSync(join(HERE, name), JSON.stringify(body, null, 1));
    const n = Array.isArray(body?.features) ? body.features.length : "?";
    console.log(`${name}: ${n} features`);
  } catch (e) {
    console.error(`${name}: ${String(e).slice(0, 120)} — skipped`);
  }
}
