"use client";

import { useRef, useState } from "react";
import { ChartDownload } from "./ChartDownload";
import { CHART, VIEW } from "./theme";

export interface HoverRow {
  label: string;
  value: string;
  color: string;
}

export interface HoverPoint {
  /** Position in viewBox coordinates. */
  x: number;
  y: number;
  title: string;
  rows: HoverRow[];
}

export interface HoverChartProps {
  testId: string;
  ariaLabel: string;
  points: HoverPoint[];
  children: React.ReactNode;
  /** "x" for line charts (crosshair), "xy" for scatter plots. */
  nearestBy?: "x" | "xy";
  /** viewBox height; frames other than the default VIEW set it. */
  height?: number;
}

/**
 * The hover layer every chart ships with. A vertical crosshair snaps to the
 * nearest data position, so the reader aims at an x, never at a 2px line; one
 * tooltip lists every series there, value first. Tooltips enhance and never
 * gate: each chart also has a table view.
 */
export function HoverChart({ testId, ariaLabel, points, children, nearestBy = "x", height = VIEW.height }: HoverChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const nearest = (clientX: number, clientY: number): number | null => {
    const svg = svgRef.current;
    if (svg === null || points.length === 0) return null;
    const rect = svg.getBoundingClientRect();
    const vx = ((clientX - rect.left) / Math.max(1, rect.width)) * VIEW.width;
    const vy = ((clientY - rect.top) / Math.max(1, rect.height)) * height;
    // Line charts snap by x (a crosshair); scatter plots by distance.
    const d = (i: number) => (nearestBy === "x" ? Math.abs(points[i]!.x - vx) : Math.hypot(points[i]!.x - vx, points[i]!.y - vy));
    let best = 0;
    for (let i = 1; i < points.length; i++) if (d(i) < d(best)) best = i;
    return best;
  };

  const p = active === null ? null : points[active];

  return (
    <div data-testid={testId} style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW.width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
        tabIndex={0}
        onPointerMove={(e) => setActive(nearest(e.clientX, e.clientY))}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(points.length > 0 ? points.length - 1 : null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (points.length === 0) return;
          if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? 0) - 1));
          if (e.key === "ArrowRight") setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1));
        }}
      >
        {children}
        {p && (
          <g pointerEvents="none" data-export="skip">
            {nearestBy === "x" && <line x1={p.x} x2={p.x} y1={VIEW.top} y2={height - VIEW.bottom} stroke={CHART.textMuted} strokeWidth={1} />}
            <circle cx={p.x} cy={p.y} r={5} fill={CHART.observed} stroke={CHART.surface} strokeWidth={2} />
          </g>
        )}
      </svg>
      {p && (
        <div
          data-testid={`${testId}-tooltip`}
          style={{
            position: "absolute",
            left: `${Math.min(78, (p.x / VIEW.width) * 100 + 2)}%`,
            top: 8,
            pointerEvents: "none",
            background: "var(--bg-panel-raised)",
            border: "1px solid var(--line)",
            padding: "6px 9px",
            fontSize: 11,
            lineHeight: 1.55,
            minWidth: 150,
          }}
        >
          <div style={{ color: "var(--text-dim)", marginBottom: 2 }}>{p.title}</div>
          {p.rows.map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 2, background: r.color, display: "inline-block" }} />
              <strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>{r.value}</strong>
              <span style={{ color: "var(--text-dim)" }}>{r.label}</span>
            </div>
          ))}
        </div>
      )}
      <ChartDownload svgRef={svgRef} name={testId} />
    </div>
  );
}
