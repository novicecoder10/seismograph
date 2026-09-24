"use client";

import { linearScale } from "@/lib/charts/scales";
import type { Scoreboard } from "@/lib/ledger/summary";
import { DataTable } from "../charts/DataTable";
import { Frame } from "../charts/Frame";
import { HoverChart, type HoverPoint } from "../charts/HoverChart";
import { Legend } from "../charts/Legend";
import { CHART, VIEW } from "../charts/theme";

const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

/**
 * Reliability diagram: for forecasts that said "x% chance of at least one", how
 * often did at least one happen? A calibrated model sits on the diagonal.
 */
export function Reliability({ bins }: { bins: Scoreboard["calibration"] }) {
  const used = bins.filter((b) => b.n > 0);
  const x = linearScale([0, 1], [VIEW.left, VIEW.width - VIEW.right], 5);
  const y = linearScale([0, 1], [VIEW.height - VIEW.bottom, VIEW.top], 5);
  const points: HoverPoint[] = used.map((b) => ({
    x: x(b.meanForecast),
    y: y(b.observed),
    title: `forecasts of ${pct(b.lo)}–${pct(b.hi)}`,
    rows: [
      { label: "mean forecast", value: pct(b.meanForecast), color: CHART.model },
      { label: "observed", value: `${pct(b.observed)} (95%: ${pct(b.ci95[0])}–${pct(b.ci95[1])})`, color: CHART.observed },
      { label: "forecasts", value: String(b.n), color: CHART.textMuted },
    ],
  }));
  return (
    <div>
      <Legend
        items={[
          { label: "observed frequency, 95% interval", color: CHART.observed, kind: "dot" },
          { label: "perfect calibration", color: CHART.model, kind: "line" },
        ]}
      />
      <HoverChart testId="chart-reliability" ariaLabel="Reliability of forecast probabilities" points={points}>
        <Frame x={x} y={y} xLabel="forecast chance of at least one" yLabel="how often at least one happened" xFormat={(v) => `${Math.round(v * 100)}%`} yFormat={(v) => `${Math.round(v * 100)}%`}>
          <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={CHART.model} strokeWidth={2} strokeLinecap="round" />
          {used.map((b) => (
            <g key={b.lo}>
              <line x1={x(b.meanForecast)} x2={x(b.meanForecast)} y1={y(b.ci95[0])} y2={y(b.ci95[1])} stroke={CHART.observed} strokeWidth={2} strokeLinecap="round" />
              <circle cx={x(b.meanForecast)} cy={y(b.observed)} r={5} fill={CHART.observed} stroke={CHART.surface} strokeWidth={2} />
            </g>
          ))}
        </Frame>
      </HoverChart>
      <DataTable
        caption="Reliability"
        columns={["forecast range", "forecasts", "mean forecast", "observed", "95% interval"]}
        rows={bins.map((b) => [`${pct(b.lo)}–${pct(b.hi)}`, b.n, b.n ? pct(b.meanForecast) : "—", b.n ? pct(b.observed) : "—", b.n ? `${pct(b.ci95[0])}–${pct(b.ci95[1])}` : "—"])}
      />
    </div>
  );
}
