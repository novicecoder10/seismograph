"use client";

import { linearScale, logScale } from "@/lib/charts/scales";
import type { BValueEstimate } from "@/lib/science/bvalue";
import type { MagnitudeBins } from "@/lib/science/magnitude";
import { isRefusal, type Refusal } from "@/lib/science/refusal";
import { DataTable } from "../charts/DataTable";
import { Frame } from "../charts/Frame";
import { HoverChart, type HoverPoint } from "../charts/HoverChart";
import { Legend } from "../charts/Legend";
import { CHART, VIEW } from "../charts/theme";

export function FrequencyMagnitude({
  bins,
  cumulative,
  mc,
  b,
}: {
  bins: MagnitudeBins;
  cumulative: number[];
  mc: number | null;
  b: BValueEstimate | Refusal;
}) {
  if (bins.edges.length === 0) {
    return <p data-testid="chart-fmd" style={{ color: "var(--text-dim)", fontSize: 12 }}>No events.</p>;
  }
  const w = bins.binWidth;
  const x = linearScale([bins.edges[0]! - w, bins.edges.at(-1)! + w], [VIEW.left, VIEW.width - VIEW.right], 6);
  const maxCum = Math.max(...cumulative);
  const y = logScale([0.8, Math.max(10, maxCum * 1.6)], [VIEW.height - VIEW.bottom, VIEW.top]);

  let model: ((m: number) => number) | null = null;
  if (!isRefusal(b) && mc !== null) {
    const idx = bins.edges.findIndex((e) => e >= mc - 1e-9);
    if (idx >= 0) {
      const a = Math.log10(cumulative[idx]!) + b.b * mc;
      model = (m: number) => 10 ** (a - b.b * m);
    }
  }

  const points: HoverPoint[] = bins.edges.map((m, i) => ({
    x: x(m),
    y: y(cumulative[i]!),
    title: `M ${m.toFixed(1)}`,
    rows: [
      { label: "at or above", value: cumulative[i]!.toLocaleString(), color: CHART.observed },
      { label: "in this bin", value: bins.counts[i]!.toLocaleString(), color: CHART.secondary },
      ...(model !== null && mc !== null && m >= mc - 1e-9
        ? [{ label: "Gutenberg-Richter", value: model(m).toFixed(0), color: CHART.model }]
        : []),
    ],
  }));

  return (
    <div>
      <Legend
        items={[
          { label: "N(≥M), cumulative", color: CHART.observed, kind: "dot" },
          { label: "count per bin", color: CHART.secondary, kind: "dot" },
          { label: "Gutenberg-Richter fit above Mc", color: CHART.model, kind: "line" },
        ]}
      />
      <HoverChart testId="chart-fmd" ariaLabel="Frequency-magnitude distribution" points={points}>
        <Frame x={x} y={y} xLabel="magnitude" yLabel="number of events (log)">
          {mc !== null && (
            <g>
              <line x1={x(mc)} x2={x(mc)} y1={VIEW.top} y2={VIEW.height - VIEW.bottom} stroke={CHART.textMuted} strokeWidth={1} />
              <text x={x(mc) + 4} y={VIEW.top + 12} fontSize={11} fill={CHART.textSecondary}>
                Mc {mc.toFixed(1)}
              </text>
            </g>
          )}
          {model !== null && mc !== null && (
            <line
              x1={x(mc)}
              y1={y(model(mc))}
              x2={x(bins.edges.at(-1)!)}
              y2={y(Math.max(0.8, model(bins.edges.at(-1)!)))}
              stroke={CHART.model}
              strokeWidth={2}
              strokeLinecap="round"
            />
          )}
          {bins.edges.map((m, i) =>
            bins.counts[i]! > 0 ? (
              <circle key={`i${m}`} cx={x(m)} cy={y(bins.counts[i]!)} r={3.5} fill={CHART.secondary} stroke={CHART.surface} strokeWidth={2} />
            ) : null,
          )}
          {bins.edges.map((m, i) => (
            <circle key={`c${m}`} cx={x(m)} cy={y(cumulative[i]!)} r={4} fill={CHART.observed} stroke={CHART.surface} strokeWidth={2} />
          ))}
        </Frame>
      </HoverChart>
      {isRefusal(b) && <p style={{ fontSize: 11, color: "var(--text-dim)" }}>No fit line: {b.reason}</p>}
      <DataTable
        caption="Frequency-magnitude distribution"
        columns={["magnitude", "N(≥M)", "in bin"]}
        rows={bins.edges.map((m, i) => [m.toFixed(1), cumulative[i]!, bins.counts[i]!])}
      />
    </div>
  );
}
