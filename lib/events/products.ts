/**
 * The USGS product tree (spec §5, Phase 1: "not a pin and a JPEG").
 *
 * Every field is optional at every level: most events carry only `origin` and
 * `phase-data`, and a product can exist while its `contents` map lacks the key
 * we want. Nothing here throws; an absent product reads as null so the page can
 * omit the section rather than render an empty one.
 */
export interface OriginSolution {
  source: string;
  magnitude: number | null;
  magnitudeError: number | null;
  magType: string | null;
  depthKm: number | null;
  depthError: number | null;
  lat: number | null;
  lon: number | null;
  horizontalErrorKm: number | null;
  azimuthalGapDeg: number | null;
  numPhases: number | null;
  status: string | null;
  updatedMs: number | null;
}

export interface NodalPlane {
  strike: number;
  dip: number;
  rake: number;
}

export interface MomentTensor {
  source: string;
  magnitude: number | null;
  magType: string | null;
  depthKm: number | null;
  percentDoubleCouple: number | null;
  planes: [NodalPlane, NodalPlane] | null;
}

export interface EventProducts {
  origins: OriginSolution[];
  shakemap: {
    maxMmi: number | null;
    contourMmiUrl: string | null;
    ruptureUrl: string | null;
    infoUrl: string | null;
    intensityImageUrl: string | null;
  } | null;
  dyfi: {
    responses: number | null;
    maxCdi: number | null;
    geo1kmUrl: string | null;
    geo10kmUrl: string | null;
  } | null;
  pager: {
    alertLevel: string | null;
    maxMmi: number | null;
    exposuresUrl: string | null;
    onePagerUrl: string | null;
  } | null;
  momentTensors: MomentTensor[];
  groundFailure: { landslideAlert: string | null; liquefactionAlert: string | null } | null;
  /** USGS Operational Aftershock Forecast, when USGS issued one. */
  oaf: { forecastUrl: string; forecastDataUrl: string | null; updatedMs: number | null } | null;
}

type ProductItem = {
  source?: unknown;
  updateTime?: unknown;
  properties?: Record<string, unknown>;
  contents?: Record<string, { url?: unknown }>;
};

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function contentUrl(item: ProductItem, key: string): string | null {
  const entry = item.contents?.[key];
  return str(entry?.url);
}

function productList(detail: unknown, name: string): ProductItem[] {
  if (typeof detail !== "object" || detail === null) return [];
  const products = (detail as { properties?: { products?: unknown } }).properties?.products;
  if (typeof products !== "object" || products === null) return [];
  const list = (products as Record<string, unknown>)[name];
  return Array.isArray(list) ? (list as ProductItem[]) : [];
}

function parseOrigin(item: ProductItem): OriginSolution {
  const p = item.properties ?? {};
  return {
    source: str(item.source) ?? str(p.eventsource) ?? "unknown",
    magnitude: num(p.magnitude),
    magnitudeError: num(p["magnitude-error"]),
    magType: str(p["magnitude-type"]),
    depthKm: num(p.depth),
    depthError: num(p["vertical-error"]) ?? num(p["depth-error"]),
    lat: num(p.latitude),
    lon: num(p.longitude),
    horizontalErrorKm: num(p["horizontal-error"]),
    azimuthalGapDeg: num(p["azimuthal-gap"]),
    numPhases: num(p["num-phases-used"]) ?? num(p["num-stations-used"]),
    status: str(p["evaluation-status"]) ?? str(p["review-status"]),
    updatedMs: num(item.updateTime),
  };
}

function parseMomentTensor(item: ProductItem): MomentTensor {
  const p = item.properties ?? {};
  const s1 = num(p["nodal-plane-1-strike"]);
  const d1 = num(p["nodal-plane-1-dip"]);
  const r1 = num(p["nodal-plane-1-rake"]);
  const s2 = num(p["nodal-plane-2-strike"]);
  const d2 = num(p["nodal-plane-2-dip"]);
  const r2 = num(p["nodal-plane-2-rake"]);
  const complete = [s1, d1, r1, s2, d2, r2].every((v) => v !== null);
  return {
    source: str(item.source) ?? str(p["beachball-source"]) ?? "unknown",
    magnitude: num(p["derived-magnitude"]),
    magType: str(p["derived-magnitude-type"]),
    depthKm: num(p["derived-depth"]),
    percentDoubleCouple: num(p["percent-double-couple"]),
    planes: complete
      ? [
          { strike: s1!, dip: d1!, rake: r1! },
          { strike: s2!, dip: d2!, rake: r2! },
        ]
      : null,
  };
}

export function parseProducts(detail: unknown): EventProducts {
  const origins = productList(detail, "origin").map(parseOrigin);
  const momentTensors = productList(detail, "moment-tensor").map(parseMomentTensor);

  const shakemapItem = productList(detail, "shakemap")[0];
  const shakemap =
    shakemapItem === undefined
      ? null
      : {
          maxMmi: num(shakemapItem.properties?.maxmmi),
          contourMmiUrl: contentUrl(shakemapItem, "download/cont_mmi.json"),
          ruptureUrl: contentUrl(shakemapItem, "download/rupture.json"),
          infoUrl: contentUrl(shakemapItem, "download/info.json"),
          intensityImageUrl: contentUrl(shakemapItem, "download/intensity.jpg"),
        };

  const dyfiItem = productList(detail, "dyfi")[0];
  const dyfi =
    dyfiItem === undefined
      ? null
      : {
          responses: num(dyfiItem.properties?.["num-responses"]) ?? num(dyfiItem.properties?.numResp),
          maxCdi: num(dyfiItem.properties?.maxmmi),
          geo1kmUrl: contentUrl(dyfiItem, "dyfi_geo_1km.geojson"),
          geo10kmUrl: contentUrl(dyfiItem, "dyfi_geo_10km.geojson"),
        };

  const pagerItem = productList(detail, "losspager")[0];
  const pager =
    pagerItem === undefined
      ? null
      : {
          alertLevel: str(pagerItem.properties?.alertlevel),
          maxMmi: num(pagerItem.properties?.maxmmi),
          exposuresUrl: contentUrl(pagerItem, "json/exposures.json"),
          onePagerUrl: contentUrl(pagerItem, "onepager.pdf"),
        };

  const gfItem = productList(detail, "ground-failure")[0];
  const groundFailure =
    gfItem === undefined
      ? null
      : {
          landslideAlert: str(gfItem.properties?.["landslide-alert"]),
          liquefactionAlert: str(gfItem.properties?.["liquefaction-alert"]),
        };

  const oafItem = productList(detail, "oaf")[0];
  const oafUrl = oafItem ? contentUrl(oafItem, "forecast.json") : null;
  const oaf =
    oafItem && oafUrl
      ? { forecastUrl: oafUrl, forecastDataUrl: contentUrl(oafItem, "forecast_data.json"), updatedMs: num(oafItem.updateTime) }
      : null;

  return { origins, shakemap, dyfi, pager, momentTensors, groundFailure, oaf };
}

export function detailUrl(sourceId: string): string {
  return (
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/" +
    `${encodeURIComponent(sourceId)}.geojson`
  );
}
