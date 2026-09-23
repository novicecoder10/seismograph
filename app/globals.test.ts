import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The visual identity is a stated constraint of the design, so it gets a test
// rather than a promise. These values come from the original src/index.css.
const css = readFileSync("app/globals.css", "utf8");

describe("design tokens carried over from the Vite app", () => {
  const tokens = {
    "--bg-void": "#0a0c0e",
    "--bg-panel": "#12161a",
    "--bg-panel-raised": "#171c21",
    "--line": "#232a30",
    "--text-primary": "#e7ebee",
    "--text-dim": "#7c8790",
    "--text-faint": "#4d565d",
    "--accent-warn": "#fb923c",
  };
  for (const [name, value] of Object.entries(tokens)) {
    it(`keeps ${name} as ${value}`, () => {
      expect(css).toMatch(new RegExp(`${name}\\s*:\\s*${value}`, "i"));
    });
  }
  it("keeps IBM Plex Mono and Space Grotesk", () => {
    expect(css).toContain("IBM Plex Mono");
    expect(css).toContain("Space Grotesk");
  });
  it("keeps the 50px grid-line motif", () => {
    expect(css).toContain("50px 100%");
  });
});
