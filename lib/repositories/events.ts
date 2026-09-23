import { describe, expect, it } from "vitest";
import { isEvent, type Event, type EventFilter } from "../events/types";

export interface EventPage {
  events: Event[];
  cursor: string | null;
  /** The number of matches before the limit was applied, when the backend can
   *  say. FDSN cannot without a second request, so it reports null. */
  total: number | null;
}

/**
 * THE storage boundary (spec §4). Every read in the application goes through an
 * implementation of this, so the historical backend can move from FDSN to
 * Postgres to Parquet without touching a single component.
 */
export interface EventRepository {
  readonly name: string;
  query(filter: EventFilter, opts?: { limit?: number; cursor?: string }): Promise<EventPage>;
  byId(id: string): Promise<Event | null>;
}

/**
 * The contract every implementation satisfies. Phase 1b's Supabase repository
 * must pass this unchanged — that is the whole reason it is written here, before
 * any second implementation exists.
 */
export function describeEventRepository(
  name: string,
  make: () => EventRepository | Promise<EventRepository>,
): void {
  describe(`EventRepository contract: ${name}`, () => {
    const baseFilter: EventFilter = {
      range: { startMs: Date.UTC(2026, 8, 15), endMs: Date.UTC(2026, 8, 22) },
      minMagnitude: 4.5,
      maxMagnitude: null,
      minDepthKm: null,
      maxDepthKm: null,
      bbox: null,
    };

    it("returns only valid Events", async () => {
      const page = await (await make()).query(baseFilter, { limit: 50 });
      expect(page.events.every(isEvent)).toBe(true);
    });

    it("respects the magnitude floor", async () => {
      const page = await (await make()).query(
        { ...baseFilter, minMagnitude: 5.5 },
        { limit: 50 },
      );
      for (const e of page.events) expect(e.magnitude).toBeGreaterThanOrEqual(5.5);
    });

    it("respects the magnitude ceiling", async () => {
      const page = await (await make()).query(
        { ...baseFilter, maxMagnitude: 5.0 },
        { limit: 50 },
      );
      for (const e of page.events) expect(e.magnitude).toBeLessThanOrEqual(5.0);
    });

    it("respects the time range", async () => {
      const page = await (await make()).query(baseFilter, { limit: 50 });
      for (const e of page.events) {
        expect(e.time).toBeGreaterThanOrEqual(baseFilter.range.startMs);
        expect(e.time).toBeLessThanOrEqual(baseFilter.range.endMs);
      }
    });

    it("returns events in descending time order", async () => {
      const page = await (await make()).query(baseFilter, { limit: 50 });
      const times = page.events.map((e) => e.time);
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it("honours the limit", async () => {
      const page = await (await make()).query(baseFilter, { limit: 5 });
      expect(page.events.length).toBeLessThanOrEqual(5);
    });

    it("returns an empty page rather than throwing for a range that matches nothing", async () => {
      const t = Date.UTC(2026, 8, 20, 12, 0, 0);
      const page = await (await make()).query(
        { ...baseFilter, range: { startMs: t, endMs: t }, minMagnitude: 9.5 },
        { limit: 10 },
      );
      expect(page.events).toHaveLength(0);
    });

    it("returns null from byId for an unknown id rather than throwing", async () => {
      expect(await (await make()).byId("usgs:definitely-not-an-event-id")).toBeNull();
    });

    it("returns null from byId for a malformed id", async () => {
      for (const id of ["", "nocolon", ":", "unknownsource:x"]) {
        expect(await (await make()).byId(id)).toBeNull();
      }
    });

    it("round-trips an event through query then byId", async () => {
      const repo = await make();
      const page = await repo.query(baseFilter, { limit: 1 });
      // An empty catalogue window is not a contract failure.
      if (page.events.length === 0) return;
      const first = page.events[0]!;
      expect((await repo.byId(first.id))?.id).toBe(first.id);
    });

    it("filters by an antimeridian-crossing bbox without inverting it", async () => {
      const page = await (await make()).query(
        { ...baseFilter, bbox: { west: 170, east: -170, south: -20, north: 20 } },
        { limit: 50 },
      );
      for (const e of page.events) {
        expect(Math.abs(e.lat)).toBeLessThanOrEqual(20);
        expect(Math.abs(e.lon)).toBeGreaterThanOrEqual(170);
      }
    });
  });
}
