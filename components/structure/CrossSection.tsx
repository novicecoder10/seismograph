"use client";

import { linearScale } from "@/lib/charts/scales";
import { DataTable } from "../charts/DataTable";
import { Frame } from "../charts/Frame";
import { HoverChart, type HoverPoint } from "../charts/HoverChart";
import { Legend } from "../charts/Legend";
import { CHART, VIEW } from "../charts/theme";

const H = 400;

export interface SectionPoint {
  id: string;
  alongKm: number;
  depthKm: number;
  magnitude: number;
  time: number;
  place: string;
}

export interface CrossSectionProps {
  points: SectionPoint[];
  mainId: string;
  halfLengthKm: number;
  slab: { alongKm: number; depthKm: number | null }[];
  slabName: string | null;
  azimuthDeg: number;
}

export function CrossSection(p: CrossSectionProps) {
  const maxDepth = Math.max(100, Math.ceil((Math.max(0, ...p.points.map((q) => q.depthKm), ...p.slab.map((s) => s.depthKm ?? 0)) + 30) / 100) * 100);
  const x = linearScale([-p.halfLengthKm, p.halfLengthKm], [VIEW.left, VIEW.width - VIEW.right], 6);
  const y = linearScale([0, maxDepth], [VIEW.top, H - VIEW.bottom], 6);
  const r = (m: number) => Math.max(1.8, 1.8 + (m - 4.5) * 1.6);
  const main = p.points.find((q) => q.id === p.mainId);

  let slabPath = "";
  let pen = false;
  for (const s of p.slab) {
    if (s.depthKm === null) { pen = false; continue; }
    slabPath += `${pen ? "L" : "M"}${x(s.alongKm).toFixed(1)},${y(s.depthKm).toFixed(1)}`;
    pen = true;
  }

  const hover: HoverPoint[] = p.points.map((q) => ({
    x: x(q.alongKm), y: y(q.depthKm), title: `M ${q.magnitude.toFixed(1)} · ${new Date(q.time).toISOString().slice(0, 10)}`,
    rows: [
      { label: "depth", value: `${q.depthKm.toFixed(0)} km`, color: CHART.observed },
      { label: "along section", value: `${q.alongKm.toFixed(0)} km`, color: CHART.textMuted },
      { label: "place", value: q.place, color: CHART.textMuted },
    ],
  }));

  return (
    <div>
      <Legend items={[
        { label: "earthquakes", color: CHART.observed, kind: "dot" },
        { label: "this earthquake", color: CHART.model, kind: "dot" },
        ...(p.slabName ? [{ label: `slab top (Slab2, ${p.slabName})`, color: CHART.secondary, kind: "line" as const }] : []),
      ]} />
      <HoverChart testId="chart-section" ariaLabel="Depth cross-section of earthquakes along the section line" points={hover} nearestBy="xy" height={H}>
        <Frame height={H} x={x} y={y} xLabel={`km along the section (toward ${p.azimuthDeg.toFixed(0)}°)`} yLabel="depth (km)">
          {slabPath && <path d={slabPath} fill="none" stroke={CHART.secondary} strokeWidth={2} strokeLinejoin="round" />}
          {p.points.map((q) => q.id === p.mainId ? null : (
            <circle key={q.id} cx={x(q.alongKm)} cy={y(q.depthKm)} r={r(q.magnitude)} fill={CHART.observed} fillOpacity={0.55} />
          ))}
          {main && <circle cx={x(main.alongKm)} cy={y(main.depthKm)} r={Math.max(6, r(main.magnitude) + 2)} fill={CHART.model} stroke={CHART.surface} strokeWidth={2} />}
        </Frame>
      </HoverChart>
      <DataTable
        caption="Earthquakes in the section"
        columns={["date", "magnitude", "depth", "along section", "place"]}
        rows={[...p.points].sort((a, b) => b.magnitude - a.magnitude).slice(0, 300).map((q) => [
          new Date(q.time).toISOString().slice(0, 10), q.magnitude.toFixed(1), `${q.depthKm.toFixed(0)} km`, `${q.alongKm.toFixed(0)} km`, q.place,
        ])}
      />
    </div>
  );
}
