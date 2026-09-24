import { describe, expect, it } from "vitest";
import { formatProbability, formatRange } from "./format";

describe("formatProbability", () => {
  it.each([
    [0, "0%"], [0.00002, "<0.01%"], [0.001859, "0.19%"], [0.01844, "1.8%"], [0.1219, "12%"],
    [0.4252, "43%"], [0.9979, ">99%"], [NaN, "—"],
  ])("%s → %s", (p, s) => expect(formatProbability(p)).toBe(s));
  it("collapses equal ranges", () => {
    expect(formatRange(0, 0)).toBe("0");
    expect(formatRange(2, 12)).toBe("2–12");
  });
});
