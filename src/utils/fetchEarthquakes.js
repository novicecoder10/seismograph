import { normalizeUSGS, normalizeEMSC } from './normalize';

const USGS_FEEDS = {
  hour: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
  day: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  week: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson',
};

const RANGE_MS = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

function emscUrl(range) {
  const end = new Date();
  const start = new Date(end.getTime() - (RANGE_MS[range] || RANGE_MS.day));
  const params = new URLSearchParams({
    format: 'geojson',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    min_mag: '0',
    limit: '500',
    orderby: 'time',
  });
  return `https://www.emsc-csem.org/service/api/1.6/get.geojson?${params.toString()}`;
}

async function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Fetches earthquake data for a given time range ('hour' | 'day' | 'week').
// Tries USGS first, falls back to EMSC on failure or timeout.
// Returns { quakes, source, fetchedAt }
export async function fetchEarthquakes(range = 'day') {
  const usgsUrl = USGS_FEEDS[range] || USGS_FEEDS.day;

  try {
    const geojson = await fetchWithTimeout(usgsUrl, 5000);
    const quakes = normalizeUSGS(geojson);
    return { quakes, source: 'USGS', fetchedAt: Date.now() };
  } catch (usgsErr) {
    try {
      const geojson = await fetchWithTimeout(emscUrl(range), 5000);
      const quakes = normalizeEMSC(geojson);
      return { quakes, source: 'EMSC', fetchedAt: Date.now() };
    } catch (emscErr) {
      const err = new Error(
        `Both data sources failed. USGS: ${usgsErr.message}. EMSC: ${emscErr.message}`
      );
      err.usgsErr = usgsErr;
      err.emscErr = emscErr;
      throw err;
    }
  }
}
