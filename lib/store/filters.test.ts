import { beforeEach, describe, expect, it } from "vitest";
import { useFilterStore } from "./filters";
import { useTimeStore } from "./time";
import { decodeViewState, defaultViewState } from "./url";

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

describe("useFilterStore", () => {
  beforeEach(() => {
    const d = defaultViewState(NOW);
    useFilterStore.setState({
      filter: d.filter,
      view: d.view,
      camera: d.camera,
      selectedId: d.selectedId,
    });
    useTimeStore.setState({
      t: d.t,
      rate: 1,
      playing: false,
      followLive: true,
      range: d.filter.range,
      lastTickMs: null,
    });
  });

  it("hydrating an empty search yields the M4.5+, seven-day default", () => {
    useFilterStore.getState().hydrateFromUrl("", NOW);
    const f = useFilterStore.getState().filter;
    expect(f.minMagnitude).toBe(4.5);
    expect(f.range.endMs - f.range.startMs).toBe(7 * 86_400_000);
    expect(useFilterStore.getState().view).toBe("globe");
  });

  it("hydrate then serialise is idempotent", () => {
    const qs = "minmag=5.5&from=1790000000000&to=1790136000000&rate=3600&view=table";
    useFilterStore.getState().hydrateFromUrl(qs, NOW);
    const first = useFilterStore.getState().toQueryString();
    useFilterStore.getState().hydrateFromUrl(first, NOW);
    expect(useFilterStore.getState().toQueryString()).toBe(first);
  });

  it("a serialised state decodes back to the same filter", () => {
    useFilterStore.getState().setFilter({ minMagnitude: 6.2, maxMagnitude: 8 });
    const back = decodeViewState(useFilterStore.getState().toQueryString(), NOW);
    expect(back.filter.minMagnitude).toBeCloseTo(6.2, 6);
    expect(back.filter.maxMagnitude).toBe(8);
  });

  it("setFilter with a range propagates it to the time store", () => {
    const range = { startMs: NOW - 3600_000, endMs: NOW };
    useFilterStore.getState().setFilter({ range });
    expect(useTimeStore.getState().range).toEqual(range);
  });

  it("narrowing the range re-clamps t instead of stranding it", () => {
    useTimeStore.getState().setT(NOW - 6 * 86_400_000);
    useFilterStore.getState().setFilter({ range: { startMs: NOW - 3600_000, endMs: NOW } });
    const { t, range } = useTimeStore.getState();
    expect(t).toBeGreaterThanOrEqual(range.startMs);
    expect(t).toBeLessThanOrEqual(range.endMs);
  });

  it("hydrating a URL whose t is the range end restores the live state", () => {
    useFilterStore.getState().hydrateFromUrl("from=1790000000000&to=1790136000000", NOW);
    expect(useTimeStore.getState().followLive).toBe(true);
  });

  it("hydrating a URL with an explicit mid-range t detaches from live", () => {
    useFilterStore
      .getState()
      .hydrateFromUrl("from=1790000000000&to=1790136000000&t=1790050000000", NOW);
    expect(useTimeStore.getState().followLive).toBe(false);
  });

  it("hydrating hostile input never produces an unusable state", () => {
    for (const qs of ["t=NaN", "rate=-1", "view=evil", "bbox=a,b,c,d"]) {
      useFilterStore.getState().hydrateFromUrl(qs, NOW);
      const { t, rate, range } = useTimeStore.getState();
      expect(Number.isFinite(t)).toBe(true);
      expect(rate).toBeGreaterThan(0);
      expect(t).toBeGreaterThanOrEqual(range.startMs);
      expect(t).toBeLessThanOrEqual(range.endMs);
    }
  });
});
