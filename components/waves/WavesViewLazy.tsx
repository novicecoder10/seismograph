"use client";

import dynamic from "next/dynamic";
import type { Event } from "@/lib/events/types";

/** seisplotjs and three.js are browser-only (spikes/FINDINGS.md). */
const WavesView = dynamic(() => import("./WavesView").then((m) => m.WavesView), {
  ssr: false,
  loading: () => <p style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading…</p>,
});

export function WavesViewLazy({ event }: { event: Event }) {
  return <WavesView event={event} />;
}
