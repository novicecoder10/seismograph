// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobeCanvas } from "./GlobeCanvas";

afterEach(() => {
  vi.restoreAllMocks();
});

const props = {
  events: [],
  t: Date.UTC(2026, 8, 23),
  fadeSeconds: 3600,
  onSelect: () => {},
};

describe("GlobeCanvas WebGL guard", () => {
  it("renders the fallback notice when no WebGL context is available", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<GlobeCanvas {...props} />);
    const fallback = screen.getByTestId("webgl-fallback");
    expect(fallback.textContent).toMatch(/WebGL/i);
    // It must point somewhere useful, not just apologise.
    expect(fallback.textContent).toMatch(/table view/i);
    expect(screen.queryByTestId("globe-canvas")).toBeNull();
  });
});
