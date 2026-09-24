"use client";

import { useFilterStore } from "@/lib/store/filters";

const RANGES = [
  { label: "hour", ms: 3_600_000 },
  { label: "day", ms: 86_400_000 },
  { label: "week", ms: 604_800_000 },
  { label: "month", ms: 2_592_000_000 },
  { label: "year", ms: 31_536_000_000 },
] as const;

const VIEWS = ["globe", "table"] as const;

export function FilterPanel() {
  const { filter, view, setFilter, setView } = useFilterStore();
  const spanMs = filter.range.endMs - filter.range.startMs;

  return (
    <div
      data-testid="filter-panel"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 18,
        padding: "10px 22px",
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-panel)",
        fontSize: 12,
        color: "var(--text-dim)",
      }}
    >
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        min magnitude
        <input
          data-testid="min-magnitude"
          type="range"
          min={0}
          max={8}
          step={0.1}
          value={filter.minMagnitude}
          onChange={(e) => setFilter({ minMagnitude: Number(e.target.value) })}
          style={{ width: 140, accentColor: "var(--accent-warn)" }}
        />
        <span style={{ color: "var(--text-primary)", minWidth: 28 }}>
          {filter.minMagnitude.toFixed(1)}
        </span>
      </label>

      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        range
        {RANGES.map((r) => {
          const active = Math.abs(spanMs - r.ms) < r.ms * 0.02;
          return (
            <button
              key={r.label}
              data-testid={`range-${r.label}`}
              onClick={() => {
                const endMs = Date.now();
                setFilter({ range: { startMs: endMs - r.ms, endMs } });
              }}
              style={{
                background: active ? "var(--bg-panel-raised)" : "transparent",
                color: active ? "var(--accent-warn)" : "var(--text-dim)",
                border: "1px solid var(--line)",
                padding: "4px 9px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </span>

      <span style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
        {VIEWS.map((v) => (
          <button
            key={v}
            data-testid={`view-${v}`}
            onClick={() => setView(v)}
            style={{
              background: view === v ? "var(--bg-panel-raised)" : "transparent",
              color: view === v ? "var(--accent-warn)" : "var(--text-dim)",
              border: "1px solid var(--line)",
              padding: "4px 11px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {v}
          </button>
        ))}
      </span>
    </div>
  );
}
