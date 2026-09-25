"use client";

import { useLayerStore, type LayerName } from "@/lib/store/layers";
import { useFilterStore } from "@/lib/store/filters";

const RANGES = [
  { label: "hour", ms: 3_600_000 },
  { label: "day", ms: 86_400_000 },
  { label: "week", ms: 604_800_000 },
  { label: "month", ms: 2_592_000_000 },
  { label: "year", ms: 31_536_000_000 },
] as const;

const VIEWS = ["globe", "table"] as const;

const LAYERS: [LayerName, string, string][] = [
  ["terrain", "3D terrain", "Real mountains and valleys (Terrain Tiles on AWS); tilt with right-drag to see them"],
  ["labels", "labels", "Place names and borders (OpenStreetMap)"],
  ["sunlight", "sunlight", "Real day and night at the time on the scrubber, with city lights"],
  ["xray", "x-ray", "See through the ground: every earthquake sinks to its true depth"],
  ["slabs", "subducting slabs", "Where one plate dives beneath another (Slab2); shown in x-ray"],
  ["mechanisms", "focal mechanisms", "How each fault moved, as 3D beachballs (Global CMT)"],
  ["grid", "grid", "Latitude and longitude lines"],
];

export function FilterPanel() {
  const { filter, view, setFilter, setView } = useFilterStore();
  const layers = useLayerStore();
  const spanMs = filter.range.endMs - filter.range.startMs;

  return (
    <div
      data-testid="filter-panel"
      className="filter-panel"
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

      <span className="layer-row" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginLeft: "auto" }}>
        layers
        {LAYERS.map(([l, label, title]) => (
          <button
            key={l}
            data-testid={`layer-${l}`}
            aria-pressed={layers[l]}
            title={title}
            onClick={() => layers.toggle(l)}
            style={{
              background: layers[l] ? "var(--bg-panel-raised)" : "transparent",
              color: layers[l] ? "var(--accent-warn)" : "var(--text-dim)",
              border: "1px solid var(--line)",
              padding: "4px 9px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </span>

      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
