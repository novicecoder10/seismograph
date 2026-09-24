// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Beachball } from "./Beachball";

function centreFilled(plane: { strike: number; dip: number; rake: number }): boolean {
  const { container } = render(<Beachball plane={plane} size={96} label="x" />);
  const rects = [...container.querySelectorAll("rect")].map((r) => ({ x: +r.getAttribute("x")!, y: +r.getAttribute("y")!, w: +r.getAttribute("width")!, h: +r.getAttribute("height")! }));
  return rects.some((r) => r.x <= 48 && r.x + r.w >= 48 && r.y <= 48 && r.y + r.h >= 48);
}

describe("Beachball", () => {
  it("fills the centre for a thrust and leaves it pale for a normal fault", () => {
    expect(centreFilled({ strike: 0, dip: 30, rake: 90 })).toBe(true);
    expect(centreFilled({ strike: 0, dip: 60, rake: -90 })).toBe(false);
  });

  it("labels itself for screen readers", () => {
    const { container } = render(<Beachball plane={{ strike: 10, dip: 80, rake: 5 }} label="Focal mechanism: 10/80/5" />);
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe("Focal mechanism: 10/80/5");
  });
});
