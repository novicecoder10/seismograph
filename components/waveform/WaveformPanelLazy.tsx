"use client";

import dynamic from "next/dynamic";

/**
 * PHASE 0 FINDING, ENFORCED HERE (spikes/FINDINGS.md §3):
 *
 * seisplotjs 3.2.7 evaluates `class … extends HTMLElement` at module scope, so
 * importing it anywhere on the server throws `HTMLElement is not defined`.
 *
 * Marking WaveformPanel "use client" is NOT sufficient: Next still renders
 * client components on the server for the initial HTML, which evaluates their
 * whole module graph. Only `ssr: false` keeps the module out of the server
 * bundle entirely — and `ssr: false` is itself only allowed from a client
 * component, which is why this wrapper exists.
 */
export const WaveformPanelLazy = dynamic(
  () => import("./WaveformPanel").then((m) => m.WaveformPanel),
  {
    ssr: false,
    loading: () => (
      <section
        data-testid="waveform-panel"
        style={{
          border: "1px solid var(--line)",
          background: "var(--bg-panel)",
          padding: "14px 16px",
          marginBottom: 14,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        Loading ground motion…
      </section>
    ),
  },
);
