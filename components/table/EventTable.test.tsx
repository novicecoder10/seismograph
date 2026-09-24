// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Event } from "@/lib/events/types";
import { EventTable } from "./EventTable";

const ev = (over: Partial<Event> = {}): Event => ({
  id: "usgs:x",
  source: "usgs",
  sourceId: "x",
  time: Date.UTC(2026, 8, 23, 4, 0, 0),
  lat: 0,
  lon: 0,
  depthKm: 10,
  magnitude: 5,
  magType: "mww",
  place: "somewhere",
  status: "reviewed",
  felt: null,
  cdi: null,
  mmi: null,
  alert: null,
  tsunami: false,
  sig: null,
  url: null,
  ...over,
});

describe("EventTable", () => {
  it("says so explicitly when nothing matches, rather than rendering an empty box", () => {
    render(<EventTable events={[]} onSelect={() => {}} />);
    expect(screen.getByTestId("table-empty").textContent).toMatch(/no events match/i);
  });

  it("sorts by time descending by default", () => {
    render(
      <EventTable
        events={[
          ev({ id: "usgs:old", time: Date.UTC(2026, 8, 20) }),
          ev({ id: "usgs:new", time: Date.UTC(2026, 8, 23) }),
        ]}
        onSelect={() => {}}
      />,
    );
    const rows = screen.getAllByTestId("event-row");
    expect(rows[0]!.textContent).toContain("2026-09-23");
  });

  it("renders an unknown depth as unknown, never as zero", () => {
    render(<EventTable events={[ev({ depthKm: null })]} onSelect={() => {}} />);
    expect(screen.getByTestId("event-row").textContent).toMatch(/depth unknown/);
    expect(screen.getByTestId("event-row").textContent).not.toMatch(/0\.0 km/);
  });

  it("renders a negative depth as given", () => {
    render(<EventTable events={[ev({ depthKm: -1.8 })]} onSelect={() => {}} />);
    expect(screen.getByTestId("event-row").textContent).toContain("-1.8 km");
  });

  it("labels every time as UTC", () => {
    render(<EventTable events={[ev()]} onSelect={() => {}} />);
    expect(screen.getByTestId("event-row").textContent).toContain("UTC");
  });

  it("shows the magnitude type, because scales are not interchangeable", () => {
    render(<EventTable events={[ev({ magType: "mb" })]} onSelect={() => {}} />);
    expect(screen.getByTestId("event-row").textContent).toContain("mb");
  });

  it("renders 5000 rows", () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      ev({ id: `usgs:${i}`, time: Date.UTC(2026, 8, 23) - i * 60_000 }),
    );
    const t0 = performance.now();
    render(<EventTable events={many} onSelect={() => {}} />);
    const ms = performance.now() - t0;
    console.log(`5000 rows rendered in ${ms.toFixed(0)}ms`);
    expect(screen.getAllByTestId("event-row")).toHaveLength(5000);
  });
});
