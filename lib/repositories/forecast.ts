import type { Event } from "../events/types";
import { bboxAround } from "../geo/bbox";
import { reproduceUsgs, toOafForecast } from "../oaf/build";
import { GENERIC_RJ, REGIME_DESCRIPTION, WORLD, regimeAt, type RegimeCode } from "../oaf/regimes";
import type { OafForecast } from "../oaf/types";
import { greatCircleKm } from "../science/distance";
import { genericSigma, gridAxis, rjPosterior, type RjPosterior } from "../science/rj";
import { wellsCoppersmithRuptureKm } from "../science/sequence";
import type { EventRepository } from "./events";
import { createUsgsProductRepository, type ProductRepository } from "./products";
import { createUsgsFdsnRepository } from "./usgs-fdsn";

const DAY = 86_400_000;
export const MIN_MAGNITUDE = 5.0;
export const MAX_AGE_DAYS = 365;

export type ForecastResult =
  | {
      kind: "usgs";
      event: Event;
      published: OafForecast;
      /** This implementation's reproduction of USGS's numbers from USGS's own inputs. */
      reproduction: { maxRelError: number; n: number } | null;
      productUpdatedMs: number | null;
    }
  | {
      kind: "computed";
      event: Event;
      forecast: OafForecast;
      /** The regime's generic model alone: what a typical sequence would give. */
      baseline: OafForecast;
      posterior: RjPosterior;
      regime: { code: RegimeCode; strec: string; description: string };
      searchRadiusKm: number;
      centroid: { lat: number; lon: number };
      truncated: boolean;
    }
  | { kind: "refused"; event: Event; reason: string };

export interface ForecastDeps {
  events?: EventRepository;
  products?: ProductRepository;
  fetchText?: (url: string) => Promise<string>;
  now?: () => number;
  regime?: (lat: number, lon: number) => { code: RegimeCode; strec: string };
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url, { next: { revalidate: 600 } } as RequestInit);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function searchRadiusKm(magnitude: number): number {
  return Math.min(WORLD.radiusMaxKm, Math.max(WORLD.radiusMinKm, wellsCoppersmithRuptureKm(magnitude)));
}

/** Spherical mean of positions; the epicentre when there are none. */
export function centroid(points: { lat: number; lon: number }[], fallback: { lat: number; lon: number }) {
  if (points.length === 0) return fallback;
  let x = 0, y = 0, z = 0;
  for (const p of points) {
    const la = (p.lat * Math.PI) / 180, lo = (p.lon * Math.PI) / 180;
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
  }
  const r = Math.hypot(x, y, z);
  if (r < 1e-9) return fallback;
  return { lat: (Math.asin(z / r) * 180) / Math.PI, lon: (Math.atan2(y, x) * 180) / Math.PI };
}

export async function loadForecast(eventId: string, deps: ForecastDeps = {}): Promise<ForecastResult | { error: string }> {
  const events = deps.events ?? createUsgsFdsnRepository();
  const products = deps.products ?? createUsgsProductRepository({ revalidateSeconds: 600 });
  const fetchText = deps.fetchText ?? defaultFetchText;
  const now = (deps.now ?? Date.now)();
  const lookup = deps.regime ?? regimeAt;

  let event: Event | null;
  try {
    event = await events.byId(eventId);
  } catch (e) {
    return { error: `The catalogue could not be reached to look up ${eventId} (${message(e)}).` };
  }
  if (!event) return { error: `No event with the identifier ${eventId} exists in the catalogue.` };

  // Where USGS has issued a forecast, theirs is the forecast.
  const tree = event.source === "usgs" ? await products.byEvent(event.sourceId) : null;
  if (tree?.oaf) {
    try {
      const published = JSON.parse(await fetchText(tree.oaf.forecastUrl)) as OafForecast;
      let reproduction: { maxRelError: number; n: number } | null = null;
      if (tree.oaf.forecastDataUrl) {
        try {
          reproduction = reproduceUsgs(published, await fetchText(tree.oaf.forecastDataUrl));
        } catch {
          reproduction = null;
        }
      }
      return { kind: "usgs", event, published, reproduction, productUpdatedMs: tree.oaf.updatedMs };
    } catch (e) {
      return { error: `USGS has issued a forecast for this event, but it could not be fetched (${message(e)}). None is computed here in its place.` };
    }
  }

  const ageDays = (now - event.time) / DAY;
  if (event.magnitude < MIN_MAGNITUDE) {
    return { kind: "refused", event, reason: `Forecasts are issued here for earthquakes of M ${MIN_MAGNITUDE.toFixed(1)} and above. Outside regional networks the global catalogue is complete only from about M 4.6, so a smaller mainshock has too few recorded aftershocks for its own data to move the forecast away from the generic prior.` };
  }
  if (ageDays > MAX_AGE_DAYS) {
    return { kind: "refused", event, reason: `This earthquake is ${Math.floor(ageDays)} days old. Forecasts are issued here for the first ${MAX_AGE_DAYS} days; beyond that, an aftershock rate is indistinguishable from background seismicity, which this model does not include.` };
  }
  if (ageDays < 0) return { error: "This event's origin time is in the future." };

  const regime = lookup(event.lat, event.lon);
  const generic = GENERIC_RJ[regime.code];
  const radius = searchRadiusKm(event.magnitude);

  let local: Event[];
  let truncated = false;
  try {
    const page = await events.query(
      {
        range: { startMs: event.time - 60 * DAY, endMs: now },
        minMagnitude: WORLD.sampleMagnitude,
        maxMagnitude: null, minDepthKm: null, maxDepthKm: null,
        // The circle is re-centred on the aftershock centroid, which lies within
        // one radius of the epicentre, so fetch twice the radius.
        bbox: bboxAround(event.lat, event.lon, Math.min(2 * radius, 5000)),
      },
      { limit: 20_000 },
    );
    local = page.events;
    truncated = page.cursor !== null;
  } catch (e) {
    return { error: `The aftershocks around ${eventId} could not be fetched (${message(e)}).` };
  }

  const near = local.filter((e) => e.id !== event.id && e.time > event.time &&
    greatCircleKm(event.lat, event.lon, e.lat, e.lon) <= radius);
  const centre = centroid(near.filter((e) => e.magnitude >= WORLD.centroidMagnitude), { lat: event.lat, lon: event.lon });
  const inRegion = local.filter((e) => e.id !== event.id && greatCircleKm(centre.lat, centre.lon, e.lat, e.lon) <= radius);

  const grid = { a: gridAxis(WORLD.aGrid.min, WORLD.aGrid.max, 401), p: [generic.p], c: [generic.c] };
  const prior = { mean: generic.aMean, sigma: genericSigma(generic, event.magnitude) };
  const common = {
    magMain: event.magnitude, b: generic.b, grid, prior, completeness: WORLD.completeness,
    times: inRegion.map((e) => (e.time - event.time) / DAY),
    mags: inRegion.map((e) => e.magnitude),
    fitStartDays: 0, fitEndDays: ageDays,
  };
  const posterior = rjPosterior(common);
  const baselinePost = rjPosterior({ ...common, useData: false });
  const region = { lat: centre.lat, lon: centre.lon, radiusKm: radius };
  const observations = [3, 4, 5, 6, 7].map((m) => ({ magnitude: m, count: inRegion.filter((e) => e.time > event.time && e.magnitude >= m).length }));
  const shared = { mainshockTime: event.time, issuedAt: now, completeness: WORLD.completeness, region, observations };

  return {
    kind: "computed",
    event,
    forecast: toOafForecast({ ...shared, post: posterior, modelName: "Reasenberg-Jones (1989, 1994) aftershock model (Bayesian Combination)" }),
    baseline: toOafForecast({ ...shared, post: baselinePost, modelName: "Reasenberg-Jones (1989, 1994) aftershock model (Generic)" }),
    posterior,
    regime: { ...regime, description: REGIME_DESCRIPTION[regime.code] },
    searchRadiusKm: radius,
    centroid: centre,
    truncated,
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
