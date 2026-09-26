import { describe, expect, it } from "vitest";
import type { Event } from "../events/types";
import type { SequenceAnalysis } from "../science/sequence";
import { depthClass, EVENT_GLOSSARY, eventEvidence, eventTemplate, magnitudeTypeName, sequenceEvidence, sequenceTemplate } from "./facts";
import { verify } from "./verify";

const ev = (over: Partial<Event> = {}): Event =>
  ({ id: "usgs:us6000tkt2", source: "usgs", sourceId: "us6000tkt2", time: Date.UTC(2026, 7, 14, 3, 7), lat: -8.3, lon: 121.4, depthKm: 10, magnitude: 7.8, magType: "mww", place: "66 km NNW of Ende, Indonesia", status: "reviewed", url: "", ...over }) as Event;

describe("event evidence", () => {
  it("classifies depth and magnitude types in words", () => {
    expect(depthClass(12)).toMatch(/^shallow/);
    expect(depthClass(150)).toMatch(/^intermediate/);
    expect(depthClass(600)).toMatch(/^deep/);
    expect(magnitudeTypeName("mww")).toMatch(/moment/);
    expect(magnitudeTypeName("mb")).toMatch(/body-wave/);
  });

  it("flags a 10 km depth as a likely default", () => {
    expect(eventEvidence(ev(), "SZ-GENERIC").caveats.join(" ")).toMatch(/default/);
    expect(eventEvidence(ev({ depthKm: 33.2 }), "SZ-GENERIC").caveats.join(" ")).not.toMatch(/default/);
  });

  it.each([
    ["a reviewed shallow Mw", ev()],
    ["an automatic deep mb", ev({ magType: "mb", depthKm: 612.4, status: "automatic", place: "Fiji region", magnitude: 4.6 })],
    ["unknown depth", ev({ depthKm: null, place: "south of Honshu, Japan" })],
  ])("writes a template that passes its own verifier: %s", (_n, e) => {
    const evidence = eventEvidence(e, "SZ-GENERIC");
    for (const p of eventTemplate(evidence)) expect(verify(p, evidence, EVENT_GLOSSARY)).toEqual([]);
  });

  it("the verifier still rejects what the evidence does not say", () => {
    const evidence = eventEvidence(ev(), "SZ-GENERIC");
    expect(verify("It was M 8.1 and more could follow near Jakarta.", evidence, EVENT_GLOSSARY).map((v) => v.kind).sort()).toEqual(["forbidden", "name", "numeral"]);
  });
});

describe("sequence evidence", () => {
  const t0 = Date.UTC(2026, 7, 14, 3, 7);
  const a = {
    mainshock: { id: "usgs:x", time: t0, lat: 0, lon: 0, depthKm: 10, magnitude: 7.8 },
    window: { radiusKm: 214.6, startMs: t0 - 30 * 86_400_000, endMs: t0 + 42 * 86_400_000, minMagnitude: 2.5, rowLimit: 3000 },
    events: new Array(260).fill(null),
    aftershocks: [{ id: "a", time: t0 + 2.2 * 86_400_000, lat: 0, lon: 0, depthKm: 10, magnitude: 6.1 }, { id: "b", time: t0 + 86_400_000, lat: 0, lon: 0, depthKm: 10, magnitude: 5.2 }],
    classification: { kind: "mainshock-aftershock", reasons: [], magnitudeGap: 1.7, largestId: "usgs:x", bathDelta: 1.7 },
    mc: { maxc: { mc: 4.3, sigma: 0.12, method: "maxc", n: 200, binWidth: 0.1 }, gft: { refused: true, reason: "x" }, used: 4.3 },
    bValue: { akiUtsu: { b: 1.04, sigma: 0.07, ci95: [0.9, 1.18], n: 150, mc: 4.3, binWidth: 0.1 }, bPositive: { refused: true, reason: "x" } },
    omori: { refused: true, reason: "too few aftershocks above completeness in the fit window" },
    declustering: { gardnerKnopoff: { mainshockClusterSize: 190 }, zaliapin: { mainshockClusterSize: 176 }, agreement: { both: 170, onlyGk: 20, onlyZbz: 6 } },
  } as unknown as SequenceAnalysis;

  it("keeps statistics with their uncertainty, and refusals with their reason", () => {
    const s = sequenceEvidence(a, t0 + 42 * 86_400_000, "66 km NNW of Ende, Indonesia");
    expect(s.sequence.bValue).toBe("1.04, with a 95% range of 0.90 to 1.18");
    expect(s.sequence.completeness).toBe("M 4.3 ± 0.12");
    expect(s.sequence.omori).toMatch(/^not fitted: too few/);
    expect(s.sequence.largestAftershock).toBe("M 6.1, 2 days after the mainshock");
    expect(s.sequence.elapsed).toBe("42 days");
    const quick = { ...a, aftershocks: [{ ...a.aftershocks[0]!, time: t0 + 3_600_000 }] } as unknown as SequenceAnalysis;
    expect(sequenceEvidence(quick, t0 + 42 * 86_400_000, "x").sequence.largestAftershock).toBe("M 6.1, 1 hour after the mainshock");
  });

  it("writes a template that passes its own verifier", () => {
    const s = sequenceEvidence(a, t0 + 42 * 86_400_000, "66 km NNW of Ende, Indonesia");
    for (const p of sequenceTemplate(s)) expect(verify(p, s, EVENT_GLOSSARY)).toEqual([]);
  });
});
