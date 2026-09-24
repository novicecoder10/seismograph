// Capture USGS Operational Aftershock Forecast products as test fixtures.
// Usage: node scripts/capture-oaf.mjs <eventid>...
// Files are written byte-for-byte: forecast_data.json holds 64-bit integers that
// a JSON round-trip through JavaScript numbers would corrupt.
import { writeFile } from "node:fs/promises";

for (const id of process.argv.slice(2)) {
  const detail = await (await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${id}&format=geojson`)).json();
  const oaf = detail.properties.products.oaf?.[0];
  if (!oaf) {
    console.error(`${id}: no oaf product`);
    continue;
  }
  for (const name of ["forecast.json", "forecast_data.json"]) {
    const text = await (await fetch(oaf.contents[name].url)).text();
    await writeFile(`test/fixtures/oaf/${id}-${name}`, text);
  }
  console.log(`${id}: captured ${oaf.updateTime}`);
}
