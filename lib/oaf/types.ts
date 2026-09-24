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

export interface OafForecast {
  creationTime: number;
  expireTime?: number;
  advisoryTimeFrame?: string;
  observations?: { magnitude: number; count: number }[];
  model: {
    name: string;
    parameters: {
      a: number; b: number; magMain: number; p: number; c: number;
      aSigma: number; pSigma: number;
      Mcat: number; F: number; G: number; H: number;
      regionType?: string; regionCenterLat?: number; regionCenterLon?: number; regionRadius?: number;
    };
  };
  fractileProbabilities: number[];
  barLabels: number[];
  forecast: OafWindow[];
}

/** The fractiles and bar labels USGS publishes: 0.01 to 0.99 in steps of 0.005. */
export const FRACTILE_PROBABILITIES = Array.from({ length: 197 }, (_, i) => Number((0.01 + i * 0.005).toFixed(3)));
export const BAR_LABELS = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500];
