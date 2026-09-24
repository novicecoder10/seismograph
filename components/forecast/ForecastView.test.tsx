// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Event } from "@/lib/events/types";
import { isOafForecast } from "@/lib/oaf/types";
import { ForecastView } from "./ForecastView";

const event: Event = { id: "usgs:x", source: "usgs", sourceId: "x", time: Date.UTC(2026, 8, 21), lat: -8, lon: 120, depthKm: 20,
  magnitude: 7.8, magType: "mww", place: "Flores Sea", status: "reviewed", felt: null, cdi: null, mmi: null, alert: null,
  tsunami: false, sig: null, url: null };

function text(ui: React.ReactElement) {
  const { container } = render(ui);
  return container.textContent ?? "";
}

describe("ForecastView", () => {
  for (const [file, name] of [["ci38457511-forecast.json", "RJ sequence-specific"], ["us6000tkt2-etas-forecast.json", "ETAS"]] as const) {
    it(`renders a published USGS ${name} forecast with ranges and no NaN`, () => {
      const published = JSON.parse(readFileSync(`test/fixtures/oaf/${file}`, "utf8"));
      expect(isOafForecast(published)).toBe(true);
      const t = text(<ForecastView result={{ kind: "usgs", event, published, reproduction: null, reproductionNote: "not recomputed", productUpdatedMs: null }} />);
      expect(t).toContain("Published by USGS");
      expect(t).toMatch(/\d+(\.\d+)?%/);
      expect(t).toMatch(/events/);
      expect(t).not.toMatch(/NaN|undefined|Infinity/);
      expect(t.toLowerCase()).not.toContain("predict");
    });
  }

  it("refuses with the reason", () => {
    const t = text(<ForecastView result={{ kind: "refused", event, reason: "Too small." }} />);
    expect(t).toContain("No forecast is issued for this earthquake. Too small.");
  });

  it("rejects malformed published JSON", () => {
    expect(isOafForecast({})).toBe(false);
    expect(isOafForecast({ creationTime: 1, model: { name: "x", parameters: {} }, forecast: [{ timeStart: 1, timeEnd: 2, label: "1 Day", bins: [{ magnitude: 3 }] }] })).toBe(false);
  });

  it("uses no alert semantics", () => {
    const published = JSON.parse(readFileSync("test/fixtures/oaf/ci38457511-forecast.json", "utf8"));
    const { container } = render(<ForecastView result={{ kind: "usgs", event, published, reproduction: { maxRelError: 0.0004, n: 845 }, reproductionNote: null, productUpdatedMs: null }} />);
    expect(container.querySelector('[role="alert"], [aria-live="assertive"]')).toBeNull();
  });
});
