/** The subset of a USGS `oaf` forecast.json this project reads and writes. The
 *  same shape is used for forecasts computed here, so one component renders both. */
export interface OafBin {
  magnitude: number;
  probability: number;
  median: number;
  p95minimum: number;
  p95maximum: number;
  fractileValues: number[];
  barPercentages: number[];
}

export interface OafWindow {
  timeStart: number;
  timeEnd: number;
  label: string;
  bins: OafBin[];
  aboveMainshockMag: Omit<OafBin, "median" | "p95minimum" | "p95maximum">;
}

export interface RjParameters {
  a: number; b: number; magMain: number; p: number; c: number;
  aSigma: number; pSigma: number;
  Mcat: number; F: number; G: number; H: number;
  regionType: string; regionCenterLat: number; regionCenterLon: number; regionRadius: number;
}

export function isRjParameters(p: OafForecast["model"]["parameters"]): p is RjParameters & Record<string, unknown> {
  return (["a", "b", "p", "c", "aSigma", "pSigma", "Mcat", "F", "G", "H"] as const).every((k) => typeof p[k] === "number");
}

export interface OafForecast {
  creationTime: number;
  expireTime?: number;
  advisoryTimeFrame?: string;
  observations?: { magnitude: number; count: number }[];
  model: {
    name: string;
    /** Reasenberg-Jones fields when the model is RJ; USGS also publishes ETAS
     *  forecasts whose parameters differ (ams, Mc, ...). Treat as untrusted. */
    parameters: Partial<RjParameters> & Record<string, unknown>;
  };
  fractileProbabilities: number[];
  barLabels: number[];
  forecast: OafWindow[];
}

/** The fractiles and bar labels USGS publishes: 0.01 to 0.99 in steps of 0.005. */
export const FRACTILE_PROBABILITIES = Array.from({ length: 197 }, (_, i) => Number((0.01 + i * 0.005).toFixed(3)));
export const BAR_LABELS = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Enough structure for the view to render without guessing. USGS's JSON is
 *  external input: anything short of this is reported, not rendered. */
export function isOafForecast(v: unknown): v is OafForecast {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Partial<OafForecast>;
  if (!isNum(f.creationTime) || typeof f.model?.name !== "string" || typeof f.model.parameters !== "object") return false;
  if (!Array.isArray(f.forecast) || f.forecast.length === 0) return false;
  return f.forecast.every((w) =>
    isNum(w?.timeStart) && isNum(w.timeEnd) && typeof w.label === "string" &&
    Array.isArray(w.bins) && w.bins.length === f.forecast![0]!.bins.length &&
    w.bins.every((b) => isNum(b?.magnitude) && isNum(b.probability) && isNum(b.p95minimum) && isNum(b.p95maximum)) &&
    isNum(w.aboveMainshockMag?.magnitude) && isNum(w.aboveMainshockMag.probability));
}
