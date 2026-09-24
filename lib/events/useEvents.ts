"use client";

import { useQuery } from "@tanstack/react-query";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";
import { chooseFeed, createUsgsFeedRepository } from "@/lib/repositories/usgs-feed";
import type { EventFilter } from "./types";

const feedRepo = createUsgsFeedRepository();
const fdsnRepo = createUsgsFdsnRepository();

/**
 * The only place a component learns where events come from. Phase 1b replaces
 * the two repositories here with a Supabase one and nothing else changes.
 *
 * The summary feed is CDN-cached and cheap, so it serves anything inside its
 * window; FDSN serves the rest of the catalogue. A 60-second refetch meets
 * success criterion §10.1 without a database.
 */
export function useEvents(filter: EventFilter) {
  return useQuery({
    queryKey: ["events", filter],
    queryFn: async () => {
      const repo = chooseFeed(filter.range, Date.now()) !== null ? feedRepo : fdsnRepo;
      const page = await repo.query(filter, { limit: 5000 });
      return { ...page, repository: repo.name, fetchedAt: Date.now() };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    // Keep showing the last good page while a refetch is in flight, so the globe
    // never blanks. The banner says when the data was last confirmed.
    placeholderData: (prev) => prev,
    retry: 2,
  });
}
