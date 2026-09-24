import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedupe, fetchMechanisms, monthlyUrl, monthsBetween, QUICK_URL } from "./gcmt";
import { parseNdk } from "./mechanism";

const quick = readFileSync("test/fixtures/gcmt/qcmt-head.ndk", "utf8");

describe("GCMT", () => {
  it("names monthly files as GCMT does", () => {
    expect(monthlyUrl(2026, 0)).toMatch(/NEW_MONTHLY\/2026\/jan26\.ndk$/);
  });

  it("lists months across a year boundary", () => {
    expect(monthsBetween(Date.UTC(2025, 10, 20), Date.UTC(2026, 1, 2))).toEqual([[2025, 10], [2025, 11], [2026, 0], [2026, 1]]);
  });

  it("prefers the reviewed monthly solution over the quick one", () => {
    const ms = parseNdk(quick);
    const reviewed = { ...ms[0]!, id: "M-reviewed", time: ms[0]!.time + 2000 };
    const out = dedupe([reviewed, ...ms]);
    expect(out[0]!.id).toBe("M-reviewed");
    expect(out).toHaveLength(ms.length);
  });

  it("filters to the range and survives missing monthly files", async () => {
    const seen: string[] = [];
    const out = await fetchMechanisms(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2), async (u) => {
      seen.push(u);
      return u === QUICK_URL ? quick : null;
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((m) => m.time >= Date.UTC(2026, 0, 1) && m.time <= Date.UTC(2026, 0, 2))).toBe(true);
    expect(seen).toContain(QUICK_URL);
  });

  it("refuses spans longer than three years", async () => {
    await expect(fetchMechanisms(0, Date.UTC(2026, 0, 1), async () => null)).rejects.toThrow(/three years/);
  });
});
