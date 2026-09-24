// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CatalogEvent } from "@/lib/science/decluster";
import { mulberry32, syntheticGutenbergRichter } from "@/lib/science/random";
import { analyseSequence } from "@/lib/science/sequence";
import { SequenceView } from "./SequenceView";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

function synthetic(): CatalogEvent[] {
  const rng = mulberry32(31);
  const mags = syntheticGutenbergRichter(1200, 1.0, 2.0, 0.1, rng);
  const out: CatalogEvent[] = [
    { id: "usgs:main", time: T0, lat: 35, lon: -117, depthKm: 8, magnitude: 6.5 },
  ];
  let tau = 0;
  for (let i = 0; i < mags.length; i++) {
    tau += -Math.log(1 - rng());
    const t = ((-0.1 * tau) / 150 + 0.05 ** -0.1) ** (1 / -0.1) - 0.05;
    if (!Number.isFinite(t) || t > 300) break;
    out.push({
      id: `usgs:a${i}`,
      time: T0 + t * DAY,
      lat: 35 + (rng() - 0.5) * 0.2,
      lon: -117 + (rng() - 0.5) * 0.2,
      depthKm: 8,
      magnitude: Math.min(mags[i]!, 5.7),
    });
  }
  return out;
}

describe("SequenceView", () => {
  const events = synthetic();
  const analysis = analyseSequence(events[0]!, events, T0 + 400 * DAY);

  it("renders every b-value with its uncertainty and interval", () => {
    render(<SequenceView analysis={analysis} />);
    const b = screen.getByTestId("stat-b-aki-utsu").textContent ?? "";
    expect(b).toMatch(/b = \d\.\d\d ± \d\.\d\d/);
    expect(b).toMatch(/95%/);
  });

  it("renders the Omori parameters with uncertainties", () => {
    render(<SequenceView analysis={analysis} />);
    expect(screen.getByTestId("stat-omori-p").textContent).toMatch(/p = \d\.\d\d ± \d\.\d\d/);
  });

  it("draws the four charts", () => {
    render(<SequenceView analysis={analysis} />);
    for (const id of ["chart-fmd", "chart-decay", "chart-ogata", "chart-mc-time"]) {
      expect(screen.getByTestId(id).querySelector("svg")).not.toBeNull();
    }
  });

  it("names both declustering methods side by side", () => {
    render(<SequenceView analysis={analysis} />);
    const t = screen.getByTestId("declustering").textContent ?? "";
    expect(t).toContain("Gardner-Knopoff");
    expect(t).toContain("Zaliapin");
  });

  it("states the classification and its reasons", () => {
    render(<SequenceView analysis={analysis} />);
    expect(screen.getByTestId("classification").textContent).toMatch(/mainshock-aftershock/i);
  });

  it("shows refusals as reasons, never as blank or NaN", () => {
    const lone = analyseSequence(events[0]!, [events[0]!], T0 + 10 * DAY);
    render(<SequenceView analysis={lone} />);
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/NaN|undefined|Infinity/);
    expect(screen.getByTestId("stat-b-aki-utsu").textContent).toMatch(/Only 1 event/);
  });

  it("makes no forward-looking claim", () => {
    render(<SequenceView analysis={analysis} />);
    const body = (document.body.textContent ?? "").toLowerCase();
    for (const banned of ["will occur", "forecast", "predict", "expected in the next"]) {
      expect(body).not.toContain(banned);
    }
  });
});
