"use client";

import { useMemo, useState } from "react";
import { formatDepth, formatUtc } from "@/lib/events/format";
import type { Event } from "@/lib/events/types";

type SortKey = "time" | "magnitude" | "depthKm";

export interface EventTableProps {
  events: Event[];
  onSelect(event: Event): void;
}

/**
 * The WebGL-free path to every event, so a visitor without a GPU loses the globe
 * and nothing else. Sort order is local state, deliberately not in the URL —
 * recorded here so nobody looks for it in the view state.
 */
export function EventTable({ events, onSelect }: EventTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [descending, setDescending] = useState(true);

  const sorted = useMemo(() => {
    const rows = [...events];
    rows.sort((a, b) => {
      // A null depth sorts last in either direction: it is unknown, not extreme.
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return descending ? bv - av : av - bv;
    });
    return rows;
  }, [events, sortKey, descending]);

  if (events.length === 0) {
    return (
      <p data-testid="table-empty" style={{ padding: 22, color: "var(--text-dim)" }}>
        No events match these filters.
      </p>
    );
  }

  const header = (key: SortKey, label: string) => (
    <th
      data-testid={`sort-${key}`}
      onClick={() => {
        if (key === sortKey) setDescending((d) => !d);
        else {
          setSortKey(key);
          setDescending(true);
        }
      }}
      style={{
        textAlign: "left",
        padding: "8px 12px",
        borderBottom: "1px solid var(--line)",
        color: key === sortKey ? "var(--accent-warn)" : "var(--text-dim)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontWeight: 500,
      }}
    >
      {label}
      {key === sortKey ? (descending ? " ▾" : " ▴") : ""}
    </th>
  );

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      <table
        data-testid="event-table"
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
      >
        <thead style={{ position: "sticky", top: 0, background: "var(--bg-panel)" }}>
          <tr>
            {header("time", "time (UTC)")}
            {header("magnitude", "magnitude")}
            {header("depthKm", "depth")}
            <th
              style={{
                textAlign: "left",
                padding: "8px 12px",
                borderBottom: "1px solid var(--line)",
                color: "var(--text-dim)",
                fontWeight: 500,
              }}
            >
              place
            </th>
            <th
              style={{
                textAlign: "left",
                padding: "8px 12px",
                borderBottom: "1px solid var(--line)",
                color: "var(--text-dim)",
                fontWeight: 500,
              }}
            >
              source
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => (
            <tr
              key={e.id}
              data-testid="event-row"
              onClick={() => onSelect(e)}
              style={{ cursor: "pointer", borderBottom: "1px solid var(--line)" }}
            >
              <td style={{ padding: "7px 12px", color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                {formatUtc(e.time)}
              </td>
              <td style={{ padding: "7px 12px", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                {e.magnitude.toFixed(1)}
                <span style={{ color: "var(--text-faint)" }}> {e.magType ?? ""}</span>
              </td>
              <td style={{ padding: "7px 12px", color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                {formatDepth(e.depthKm)}
              </td>
              <td style={{ padding: "7px 12px", color: "var(--text-dim)" }}>{e.place}</td>
              <td style={{ padding: "7px 12px", color: "var(--text-faint)" }}>
                {e.source.toUpperCase()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
