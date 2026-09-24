import { describe, expect, it } from "vitest";
import { formatAgo, formatDepth, formatMagnitude, formatUtc } from "./format";

describe("formatUtc", () => {
  it("always labels the zone", () => {
    expect(formatUtc(Date.UTC(2026, 8, 23, 4, 5, 6))).toBe("2026-09-23 04:05:06 UTC");
  });
  it("pads every field", () => {
    expect(formatUtc(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01 00:00:00 UTC");
  });
});

describe("formatMagnitude", () => {
  it("includes the magnitude type, because scales are not interchangeable", () => {
    expect(formatMagnitude(5.43, "mww")).toBe("M 5.4 mww");
  });
  it("omits an unknown type rather than inventing one", () => {
    expect(formatMagnitude(5.43, null)).toBe("M 5.4");
  });
});

describe("formatDepth", () => {
  it("says the depth is unknown rather than rendering zero", () => {
    expect(formatDepth(null)).toBe("depth unknown");
  });
  it("renders a negative depth as given", () => {
    expect(formatDepth(-1.8)).toBe("-1.8 km");
  });
  it("renders zero as zero", () => {
    expect(formatDepth(0)).toBe("0.0 km");
  });
});

describe("formatAgo", () => {
  const now = Date.UTC(2026, 8, 23, 12, 0, 0);
  it("covers each unit", () => {
    expect(formatAgo(now - 30_000, now)).toBe("just now");
    expect(formatAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(formatAgo(now - 2 * 86_400_000, now)).toBe("2 d ago");
  });
  it("does not claim a future event happened in the past", () => {
    expect(formatAgo(now + 60_000, now)).toBe("in the future");
  });
});
