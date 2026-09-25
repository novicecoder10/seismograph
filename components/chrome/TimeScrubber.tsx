"use client";

import { useEffect } from "react";
import { formatUtc } from "@/lib/events/format";
import { useTimeStore } from "@/lib/store/time";

const RATES = [
  { label: "1×", value: 1 },
  { label: "1 min/s", value: 60 },
  { label: "1 h/s", value: 3600 },
  { label: "1 d/s", value: 86_400 },
  { label: "1 wk/s", value: 604_800 },
] as const;

/**
 * The control for the application's primary axis. It runs a requestAnimationFrame
 * loop ONLY while playing — at rest it starts nothing, which is what keeps the
 * globe's render-on-demand guarantee intact (spikes/FINDINGS.md §2).
 */
export function TimeScrubber() {
  const { t, rate, playing, followLive, range, setT, setRate, play, pause, tick } =
    useTimeStore();

  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    const step = (now: number) => {
      tick(now);
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [playing, tick]);

  return (
    <div
      data-testid="time-scrubber"
      className="time-scrubber"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "10px 22px",
        borderTop: "1px solid var(--line)",
        background: "var(--bg-panel)",
      }}
    >
      <button
        data-testid="play-toggle"
        onClick={() => (playing ? pause() : play())}
        aria-label={playing ? "Pause" : "Play"}
        style={{
          background: "var(--bg-panel-raised)",
          color: playing ? "var(--accent-warn)" : "var(--text-primary)",
          border: "1px solid var(--line)",
          padding: "6px 14px",
          cursor: "pointer",
          minWidth: 68,
        }}
      >
        {playing ? "pause" : "play"}
      </button>

      <input
        data-testid="time-range"
        type="range"
        min={range.startMs}
        max={range.endMs}
        step={1000}
        value={t}
        onChange={(e) => setT(Number(e.target.value))}
        aria-label="Time"
        style={{ flex: 1, accentColor: "var(--accent-warn)" }}
      />

      <span
        data-testid="time-readout"
        className="time-readout"
        style={{ fontSize: 12, color: "var(--text-primary)", minWidth: 210 }}
      >
        {formatUtc(t)}
      </span>

      {followLive ? (
        <span
          data-testid="live-indicator"
          style={{ fontSize: 11, color: "var(--accent-warn)", minWidth: 40 }}
        >
          LIVE
        </span>
      ) : (
        <button
          data-testid="return-to-live"
          onClick={() => {
            setT(range.endMs);
            useTimeStore.getState().setFollowLive(true);
          }}
          style={{
            background: "transparent",
            color: "var(--text-dim)",
            border: "1px solid var(--line)",
            padding: "4px 8px",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          to live
        </button>
      )}

      <select
        data-testid="rate-select"
        value={rate}
        onChange={(e) => setRate(Number(e.target.value))}
        aria-label="Playback rate"
        style={{
          background: "var(--bg-panel-raised)",
          color: "var(--text-primary)",
          border: "1px solid var(--line)",
          padding: "5px 8px",
          fontSize: 12,
        }}
      >
        {RATES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
    </div>
  );
}
