import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeCatalog } from "../oaf/compact";
import type { OafForecast } from "../oaf/types";
import { genericSigma, gridAxis, logGamma, omoriIntegralRj, pageMc, rjForecast, rjPosterior, type RjPosterior } from "./rj";

const DAY = 86_400_000;

/** Rebuild USGS's posterior from its own published inputs. */
function reproduce(id: string): { post: RjPosterior; summary: Record<string, number>; published: OafForecast; t0: number } {
  const text = readFileSync(`test/fixtures/oaf/${id}-forecast_data.json`, "utf8");
  const fd = JSON.parse(text);
  const published: OafForecast = JSON.parse(readFileSync(`test/fixtures/oaf/${id}-forecast.json`, "utf8"));
  const t0: number = fd.mainshock.mainshock_time;
  const magMain: number = fd.mainshock.mainshock_mag;
  const mc = fd.parameters.mag_comp_params;
  const completeness = { magCat: mc.magCat, F: mc.magCompFn.capF, G: mc.magCompFn.capG, H: mc.magCompFn.capH };
  const r = fd.results;
  const cat = decodeCatalog(text);
  const common = {
    magMain, completeness,
    times: cat.map((e) => (e.time - t0) / DAY),
    mags: cat.map((e) => e.magnitude),
    fitStartDays: r.catalog_fit_start_days,
    fitEndDays: r.catalog_fit_end_days,
  };
  if (published.model.name.includes("Sequence Specific")) {
    const s = r.seq_spec_summary;
    const post = rjPosterior({
      ...common, b: s.b,
      grid: { a: gridAxis(s.min_a, s.max_a, s.num_a), p: gridAxis(s.min_p, s.max_p, s.num_p), c: gridAxis(s.min_c, s.max_c, s.num_c) },
    });
    return { post, summary: s, published, t0 };
  }
  const g = fd.parameters.generic_params;
  const s = r.bayesian_summary;
  const generic = { aMean: g.aValue_mean, aSigma: g.aValue_sigma, aSigma0: g.aValue_sigma0, aSigma1: g.aValue_sigma1, b: g.bValue, p: g.pValue, c: g.cValue };
  const post = rjPosterior({
    ...common, b: s.b,
    grid: { a: gridAxis(s.min_a, s.max_a, s.num_a), p: [g.pValue], c: [g.cValue] },
    prior: { mean: generic.aMean, sigma: genericSigma(generic, magMain) },
  });
  return { post, summary: s, published, t0 };
}

const FIXTURES = [
  ["ci38457511", "Ridgecrest M7.1, sequence-specific, 95,445-point grid"],
  ["nc75382936", "N. California M5.6, Bayesian, 121 aftershocks"],
  ["us7000ti1p", "Aleutians M6.5, Bayesian, 3 aftershocks"],
  ["us7000sq93", "Oregon offshore M5.7, Bayesian, no aftershocks"],
  ["aka2026powmkf", "interior Alaska M5.6, Bayesian, 15 aftershocks"],
] as const;

describe.each(FIXTURES)("reproducing the USGS forecast for %s (%s)", (id) => {
  const { post, summary, published, t0 } = reproduce(id);

  it("uses the same aftershocks", () => {
    const fd = JSON.parse(readFileSync(`test/fixtures/oaf/${id}-forecast_data.json`, "utf8"));
    expect(post.n).toBe(fd.results.seq_spec_summary.numAftershocks);
  });

  it("recovers the posterior means and standard deviations", () => {
    for (const k of ["a", "p", "c"] as const) {
      expect(post.mean[k]).toBeCloseTo(summary[`stat_${k}_mean`]!, 3);
      expect(post.sd[k]).toBeCloseTo(summary[`stat_${k}_sdev`]!, 3);
    }
  });

  it("matches every published probability, fractile and bar", () => {
    const mags = published.forecast[0]!.bins.map((b) => b.magnitude);
    for (const w of published.forecast) {
      const bins = rjForecast(post, (w.timeStart - t0) / DAY, (w.timeEnd - t0) / DAY,
        [...mags, w.aboveMainshockMag.magnitude], published.fractileProbabilities, published.barLabels);
      [...w.bins, w.aboveMainshockMag].forEach((pub, i) => {
        const ours = bins[i]!;
        const tol = Math.max(2e-3 * pub.probability, 1e-7);
        expect(Math.abs(ours.probability - pub.probability), `${w.label} M${pub.magnitude}`).toBeLessThanOrEqual(tol);
        expect(ours.fractiles).toEqual(pub.fractileValues);
        ours.bars.forEach((v, j) => expect(Math.abs(v - pub.barPercentages[j]!)).toBeLessThanOrEqual(1));
      });
    }
  });
});

describe("rj building blocks", () => {
  it("completeness decays with time and floors at magCat", () => {
    const c = { magCat: 3, F: 1, G: 4.5, H: 0.75 };
    expect(pageMc(0.001, 7.1, c)).toBeCloseTo(4.85, 10);
    expect(pageMc(1000, 7.1, c)).toBe(3);
    expect(pageMc(0, 7.1, c)).toBe(Infinity);
  });

  it("takes the log branch at p = 1", () => {
    expect(omoriIntegralRj(1, 10, 1, 0.01)).toBeCloseTo(Math.log(10.01 / 1.01), 12);
    expect(omoriIntegralRj(1, 10, 1 + 1e-7, 0.01)).toBeCloseTo(Math.log(10.01 / 1.01), 5);
  });

  it("log-gamma matches factorials", () => {
    expect(logGamma(1)).toBeCloseTo(0, 10);
    expect(logGamma(11)).toBeCloseTo(Math.log(3628800), 9);
  });

  it("with no aftershocks, the posterior is finite and pulled below the prior", () => {
    const post = rjPosterior({
      magMain: 6, b: 1, grid: { a: gridAxis(-4.5, -0.5, 401), p: [1.08], c: [0.018] },
      times: [], mags: [], fitStartDays: 0, fitEndDays: 30,
      completeness: { magCat: 4.6, F: 0.5, G: 0.25, H: 1 }, prior: { mean: -2.5, sigma: 0.6 },
    });
    expect(Number.isFinite(post.mean.a)).toBe(true);
    expect(post.mean.a).toBeLessThan(-2.5);
  });

  it("reports mass on the grid edge", () => {
    const post = rjPosterior({
      magMain: 6, b: 1, grid: { a: gridAxis(-4.5, -0.5, 401), p: [1], c: [0.01] },
      times: [], mags: [], fitStartDays: 0, fitEndDays: 30,
      completeness: { magCat: 4.6, F: 0.5, G: 0.25, H: 1 }, prior: { mean: -0.4, sigma: 0.05 }, useData: false,
    });
    expect(post.edgeMass).toBeGreaterThan(0.01);
  });
});
