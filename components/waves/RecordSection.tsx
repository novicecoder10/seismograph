"use client";

import { useMemo, useRef } from "react";
import { linearScale } from "@/lib/charts/scales";
import { bandpass, detrend, taper } from "@/lib/seismic/dsp";
import type { SectionStation, ThreeComponent } from "@/lib/seismic/network";
import { arrivals, phaseRow, type TravelTimeTable } from "@/lib/seismic/traveltime";
import { DataTable } from "../charts/DataTable";
import { Frame } from "../charts/Frame";
import { Legend } from "../charts/Legend";
import { CHART } from "../charts/theme";
import { FILTERS, PHASE_STYLE, SPAN_S, type FilterId } from "./phases";

const W = 640, H = 460;
const M = { left: 58, right: 18, top: 14, bottom: 46 };
const COLUMNS = 1200;

export type Component = "z" | "north" | "east";

export interface StationTrace {
  station: SectionStation;
  data: ThreeComponent | null | "loading";
}

/** Min/max per pixel column: a faithful wiggle at any zoom, without drawing
 *  every one of ~70,000 samples. */
function wigglePath(x: Float32Array, rate: number, startS: number, sx: (s: number) => number, y0: number, amp: number): string {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return "";
  const t0 = startS, t1 = startS + x.length / rate;
  const from = Math.max(0, t0), to = Math.min(SPAN_S, t1);
  let d = "";
  for (let c = 0; c < COLUMNS; c++) {
    const a = from + ((to - from) * c) / COLUMNS, b = from + ((to - from) * (c + 1)) / COLUMNS;
    const i0 = Math.max(0, Math.floor((a - t0) * rate)), i1 = Math.min(x.length, Math.ceil((b - t0) * rate));
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i < i1; i++) { lo = Math.min(lo, x[i]!); hi = Math.max(hi, x[i]!); }
    if (lo > hi) continue;
    const px = sx(a).toFixed(1);
    d += `M${px},${(y0 - (hi / peak) * amp).toFixed(1)}L${px},${(y0 - (lo / peak) * amp).toFixed(1)}`;
  }
  return d;
}

export interface RecordSectionProps {
  table: TravelTimeTable;
  depthKm: number;
  originMs: number;
  traces: StationTrace[];
  component: Component;
  filter: FilterId;
  clockS: number;
  selected: number | null;
  onScrub(seconds: number): void;
  onSelect(index: number): void;
}

export function RecordSection(p: RecordSectionProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const maxDeg = Math.min(180, Math.max(20, ...p.traces.map((t) => t.station.distanceDeg + 5)));
  const x = linearScale([0, SPAN_S], [M.left, W - M.right], 6);
  const y = linearScale([0, maxDeg], [M.top, H - M.bottom], 6);
  const amp = Math.max(6, (H - M.top - M.bottom) / Math.max(8, p.traces.length) * 0.7);
  const band = FILTERS.find((f) => f.id === p.filter)!;

  const paths = useMemo(() => p.traces.map((t) => {
    if (t.data === null || t.data === "loading") return "";
    const raw = t.data[p.component];
    if (!raw) return "";
    const x0 = taper(detrend(raw));
    const f = bandpass(x0, t.data.sampleRate, band.low, band.high);
    const startS = (t.data.startMs - p.originMs) / 1000;
    return wigglePath(f, t.data.sampleRate, startS, x, y(t.station.distanceDeg), amp);
  }), [p.traces, p.component, band.low, band.high, p.originMs, amp]);

  const curves = useMemo(() => ["P", "S", "PP", "PKP", "ScS"].map((ph) => {
    const row = phaseRow(p.table, ph, p.depthKm);
    let d = "";
    let pen = false;
    row.forEach((t, i) => {
      const deg = p.table.distMinDeg + i * p.table.distStepDeg;
      if (t < 0 || t > SPAN_S || deg > maxDeg) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(t).toFixed(1)},${y(deg).toFixed(1)}`;
      pen = true;
    });
    return { ph, d };
  }), [p.table, p.depthKm, maxDeg]);

  const toSeconds = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    return Math.min(SPAN_S, Math.max(0, ((px - M.left) / (W - M.left - M.right)) * SPAN_S));
  };
  const nearestTrace = (clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const deg = ((((clientY - r.top) / r.height) * H - M.top) / (H - M.top - M.bottom)) * maxDeg;
    let best = 0;
    p.traces.forEach((t, i) => { if (Math.abs(t.station.distanceDeg - deg) < Math.abs(p.traces[best]!.station.distanceDeg - deg)) best = i; });
    return best;
  };

  return (
    <div>
      <Legend items={[
        { label: "recorded motion", color: CHART.textPrimary, kind: "line" },
        { label: PHASE_STYLE.P!.label, color: PHASE_STYLE.P!.colour, kind: "line" },
        { label: PHASE_STYLE.S!.label, color: PHASE_STYLE.S!.colour, kind: "line" },
        { label: PHASE_STYLE.PP!.label, color: PHASE_STYLE.PP!.colour, kind: "line" },
      ]} />
      <svg
        ref={svgRef}
        data-testid="record-section"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Record section: recorded ground motion at each station against distance from the earthquake, with predicted phase arrivals"
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair", touchAction: "none" }}
        onPointerMove={(e) => p.onScrub(toSeconds(e.clientX))}
        onPointerDown={(e) => { p.onScrub(toSeconds(e.clientX)); p.onSelect(nearestTrace(e.clientY)); }}
      >
        <Frame x={x} y={y} xLabel="seconds after the earthquake" yLabel="distance from the earthquake (°)" xFormat={(v) => `${Math.round(v / 60)} min`}>
          {curves.map((c) => (
            <path key={c.ph} d={c.d} fill="none" stroke={PHASE_STYLE[c.ph]!.colour} strokeWidth={2} strokeOpacity={0.55} strokeLinecap="round" />
          ))}
          {p.traces.map((t, i) => (
            <g key={`${t.station.network}.${t.station.station}`}>
              <path d={paths[i]} fill="none" stroke={i === p.selected ? CHART.textPrimary : CHART.textSecondary} strokeWidth={i === p.selected ? 1.2 : 0.8} />
              <text x={W - M.right - 2} y={y(t.station.distanceDeg) - 3} textAnchor="end" fontSize={9} fill={CHART.textMuted}>
                {t.station.network}.{t.station.station}{t.data === null ? " · no data" : t.data === "loading" ? " · loading" : ""}
              </text>
            </g>
          ))}
          <line x1={x(p.clockS)} x2={x(p.clockS)} y1={M.top} y2={H - M.bottom} stroke={CHART.textPrimary} strokeWidth={1} strokeDasharray="3 3" />
        </Frame>
      </svg>
      <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "4px 0 0" }}>
        Each trace is scaled to its own maximum and filtered {band.label}; instrument response is not removed, so
        amplitudes are not comparable between stations. Coloured curves are iasp91 predictions, not picks.
      </p>
      <DataTable
        caption="Stations"
        columns={["station", "distance", "azimuth", "first predicted arrival", "data"]}
        rows={p.traces.map((t) => {
          const a = arrivals(p.table, p.depthKm, t.station.distanceDeg)[0];
          return [
            `${t.station.network}.${t.station.station}`,
            `${t.station.distanceDeg.toFixed(1)}°`,
            `${t.station.azimuthDeg.toFixed(0)}°`,
            a ? `${a.phase} at ${Math.round(a.timeS)} s` : "none in table",
            t.data === "loading" ? "loading" : t.data === null ? "no data" : t.data.north ? "3 components" : "vertical only",
          ];
        })}
      />
    </div>
  );
}
