import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBundle, type TargetSequence } from "./bundle";
import type { LibrarySequence } from "./features";
import { renderTemplate } from "./template";
import { classify, verify } from "./verify";

const lib: LibrarySequence[] = JSON.parse(readFileSync("data/sequences/library.json", "utf8")).sequences;
const kaikoura = lib.find((s) => s.name === "Kaikoura")!;
const target: TargetSequence = { id: "test:x", mag: 7.2, time: Date.UTC(2026, 8, 20), place: "near the coast of Somewhere", radiusKm: 90,
  events: kaikoura.events.map(([t, m, d]) => [t, m - 0.6, d]) };
const bundle = buildBundle(target, lib, Date.UTC(2026, 8, 23));

describe("the template", () => {
  it("passes its own verifier: every numeral and name comes from the bundle", () => {
    for (const p of renderTemplate(bundle)) expect(verify(p, bundle), p).toEqual([]);
  });

  it("names three most-similar and two least-similar past sequences", () => {
    expect(bundle.most).toHaveLength(3);
    expect(bundle.least).toHaveLength(2);
    const text = renderTemplate(bundle).join(" ");
    for (const c of [...bundle.most, ...bundle.least]) expect(text).toContain(c.name);
  });

  it("declines to compare small mainshocks", () => {
    const b = buildBundle({ ...target, mag: 5.4 }, lib, Date.UTC(2026, 8, 23));
    expect(b.limited).toMatch(/M 6\.0 and above/);
    expect(renderTemplate(b)).toEqual([b.limited]);
  });
});

describe("the verifier rejects what a model might add", () => {
  const good = renderTemplate(bundle)[0]!;
  const cases: [string, string][] = [
    ["an invented number", good.replace(bundle.target.count, "97")],
    ["a spelled-out number", `${good} Roughly a dozen more followed.`],
    ["a forecast", `${good} More aftershocks will follow.`],
    ["reassurance", `${good} There is no need to worry.`],
    ["hedged prediction", `${good} A larger quake could still occur.`],
    ["an invented place", `${good} It resembles the 1906 San Francisco sequence.`],
    ["an invented authority", `${good} Experts at Caltech agree.`],
    ["safety advice", `${good} Residents should evacuate.`],
    ["a probability word", `${good} The odds are low.`],
  ];
  it.each(cases)("%s", (_, text) => {
    expect(verify(text, bundle).length).toBeGreaterThan(0);
  });

  it("a reversed comparison is caught", () => {
    const c = bundle.most[0]!;
    const wrong = c.direction === "more productive than" ? "less productive than" : "more productive than";
    const v = verify(`It is ${wrong} ${c.name}.`, bundle);
    expect(v.some((x) => x.kind === "direction")).toBe(true);
  });
});

describe("intent routing", () => {
  const prediction = [
    "When will the next big one hit?", "Is this a foreshock?", "Will there be a bigger earthquake?", "What are the chances of another M7?",
    "Is it over now?", "Is a larger one coming?", "Predict the next aftershock", "How likely is an M6 this week?",
    "Could this be the beginning of something bigger?", "Is the sequence finished?", "what's the probability of a big aftershock tomorrow",
    "Do you expect more quakes?", "is this going to get worse", "odds of a tsunami-free week?",
  ];
  const safety = [
    "Is it safe to go home?", "Should I evacuate?", "Should we sleep outside tonight?", "Is there a tsunami?", "Am I in danger?",
    "I'm scared, what should I do?", "How do I protect my family?", "Is it safe to stay in my building?",
  ];
  const explain = ["What does productivity mean here?", "Why is Kaikoura on the list?", "What is Båth's law?", "How was the similarity computed?"];

  it.each(prediction)("routes %j away from the generator", (q) => expect(classify(q)).not.toBe("explain"));
  it.each(safety)("routes %j to safety sources", (q) => expect(classify(q)).toBe("safety"));
  it.each(explain)("lets %j through", (q) => expect(classify(q)).toBe("explain"));
});
