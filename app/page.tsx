"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GlobeCanvas } from "@/components/globe/GlobeCanvas";
import { ExportMenu } from "@/components/chrome/ExportMenu";
import { FilterPanel } from "@/components/chrome/FilterPanel";
import { Header } from "@/components/chrome/Header";
import { StatusBanner } from "@/components/chrome/StatusBanner";
import { TimeScrubber } from "@/components/chrome/TimeScrubber";
import { EventTable } from "@/components/table/EventTable";
import type { Event } from "@/lib/events/types";
import { useEvents } from "@/lib/events/useEvents";
import { useFilterStore } from "@/lib/store/filters";
import { useTimeStore } from "@/lib/store/time";

export default function Home() {
  const { filter, view, camera, setCamera, setSelectedId } = useFilterStore();
  const t = useTimeStore((s) => s.t);
  const timeRange = useTimeStore((s) => s.range);
  const hydrated = useRef(false);
  const [initialCamera, setInitialCamera] = useState<typeof camera>(null);
  // Nothing below the header can render on the server: the time range is seeded
  // from Date.now() and the real state comes from the URL, so a server render
  // would differ from the first client render and fail hydration.
  const [mounted, setMounted] = useState(false);

  // Hydrate once from the URL, before the first fetch, so a shared link does not
  // first load the default view and then jump.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const state = useFilterStore.getState();
    state.hydrateFromUrl(window.location.search);
    setInitialCamera(useFilterStore.getState().camera);
    setMounted(true);
  }, []);

  // Mirror state into the URL. replaceState, not pushState: scrubbing time must
  // not fill the back stack with hundreds of entries.
  useEffect(() => {
    if (!hydrated.current) return;
    const write = () => {
      // Once a link has been followed this page is on its way out; writing its
      // state into the URL now would clobber the navigation in flight.
      if (window.location.pathname !== "/") return;
      const qs = useFilterStore.getState().toQueryString();
      if (`?${qs}` === window.location.search || (qs === "" && window.location.search === "")) return;
      window.history.replaceState(window.history.state, "", qs === "" ? window.location.pathname : `?${qs}`);
    };
    write();
    const unsubFilter = useFilterStore.subscribe(write);
    const unsubTime = useTimeStore.subscribe(write);
    return () => {
      unsubFilter();
      unsubTime();
    };
  }, []);

  const query = useEvents(filter);
  const events = query.data?.events ?? [];

  // The fade window scales with the range on screen: an hour of catalogue and a
  // year of catalogue need very different notions of "recent".
  const fadeSeconds = useMemo(
    () => Math.max(60, (timeRange.endMs - timeRange.startMs) / 1000 / 40),
    [timeRange],
  );

  // On the globe a selection flies there and opens a card; the table, which has
  // no "there" to fly to, opens the event page.
  const onSelect = (event: Event | null) => setSelectedId(event?.id ?? null);
  const openEvent = (event: Event) => window.open(`/event/${encodeURIComponent(event.id)}`, "_self");

  if (!mounted) {
    return (
      <main style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <Header />
        <p style={{ padding: 22, color: "var(--text-dim)" }}>Loading catalogue…</p>
      </main>
    );
  }

  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header />
      <FilterPanel />
      <StatusBanner
        repository={query.data?.repository ?? null}
        fetchedAt={query.data?.fetchedAt ?? null}
        eventCount={events.length}
        matchedCount={query.data?.total ?? null}
        isError={query.isError}
        isFetching={query.isFetching}
      >
        <ExportMenu events={events} filter={filter} />
      </StatusBanner>
      <div style={{ flex: 1, minHeight: 0 }}>
        {view === "table" ? (
          <EventTable events={events} onSelect={(e) => openEvent(e)} />
        ) : (
          <GlobeCanvas
            events={events}
            t={t}
            fadeSeconds={fadeSeconds}
            onSelect={onSelect}
            onCameraChange={setCamera}
            initialCamera={initialCamera}
          />
        )}
      </div>
      <TimeScrubber />
    </main>
  );
}
