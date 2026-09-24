"use client";

import { formatUtc } from "@/lib/events/format";

export interface StatusBannerProps {
  repository: string | null;
  fetchedAt: number | null;
  eventCount: number;
  matchedCount: number | null;
  isError: boolean;
  isFetching: boolean;
}

/**
 * Degradation is always toward showing something, honestly labelled (spec §7).
 * When a fetch fails the banner says when the data on screen was last confirmed
 * rather than leaving the globe looking live.
 */
export function StatusBanner({
  repository,
  fetchedAt,
  eventCount,
  matchedCount,
  isError,
  isFetching,
}: StatusBannerProps) {
  const truncated = matchedCount !== null && matchedCount > eventCount;
  return (
    <div
      data-testid="status-banner"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "center",
        padding: "6px 22px",
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-panel)",
        fontSize: 11,
        color: "var(--text-dim)",
      }}
    >
      {isError ? (
        <span style={{ color: "var(--accent-warn)" }} data-testid="status-degraded">
          Feed unavailable.{" "}
          {fetchedAt === null
            ? "No data has been confirmed this session."
            : `Showing the last confirmed state, ${formatUtc(fetchedAt)}.`}
        </span>
      ) : (
        <span>
          {eventCount.toLocaleString()} events
          {truncated && (
            <span style={{ color: "var(--accent-warn)" }}>
              {" "}
              of {matchedCount!.toLocaleString()} matched — showing the most recent
            </span>
          )}
        </span>
      )}
      {repository !== null && <span>source: {repository}</span>}
      {fetchedAt !== null && <span>confirmed {formatUtc(fetchedAt)}</span>}
      {isFetching && <span data-testid="status-fetching">updating…</span>}
      <span style={{ marginLeft: "auto", color: "var(--text-faint)" }}>
        Data: USGS (public domain), EMSC (CC BY 4.0). Research and hobby use.
      </span>
    </div>
  );
}
