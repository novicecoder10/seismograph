"use client";

import { logBins, logScale } from "@/lib/charts/scales";
import { omoriRate, type OmoriFit } from "@/lib/science/omori";
import { isRefusal, type Refusal } from "@/lib/science/refusal";
import { DataTable } from "../charts/DataTable";
import { Frame } from "../charts/Frame";
import { HoverChart, type HoverPoint } from "../charts/HoverChart";
import { Legend } from "../charts/Legend";
import { CHART, VIEW } from "../charts/theme";

/** Aftershock rate in log-spaced bins on log-log axes — the only way an Omori
 *  decay appears as the straight line its power law is. */
export function DecayCurve({ timesDays, endDays, fit }: { timesDays: number[]; endDays: number; fit: OmoriFit | Refusal }) {
  const positive = timesDays.filter((t) => t > 0).sort((a, b) => a - b);
  if (positive.length < 2 || endDays <= 0) {
    return (
      <p data-testid="chart-decay" style={{ color: "var(--text-dim)", fontSize: 12 }}>
        Too few aftershocks above completeness to show a decay.
      </p>
    );
  }
  const tMin = Math.max(1e-3, 10 ** Math.floor(Math.log10(positive[0]!)));
  const edges = logBins(tMin, Math.max(endDays, tMin * 10), 4);
  const bins: { t: number; rate: number; count: number; lo: number; hi: number }[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const count = positive.filter((t) => t >= lo && t < hi).length;
    if (count > 0) bins.push({ t: Math.sqrt(lo * hi), rate: count / (hi - lo), count, lo, hi });
  }

  const model = isRefusal(fit) ? null : fit;
  const rates = bins.map((b) => b.rate);
  const modelRates = model ? [omoriRate(model, tMin), omoriRate(model, edges.at(-1)!)] : [];
  const lo = Math.min(...rates, ...modelRates);
  const hi = Math.max(...rates, ...modelRates);
  const x = logScale([tMin, edges.at(-1)!], [VIEW.left, VIEW.width - VIEW.right]);
  const y = logScale([lo / 2, hi * 2], [VIEW.height - VIEW.bottom, VIEW.top]);

  let path = "";
  if (model) {
    for (let k = 0; k <= 80; k++) {
      const t = tMin * (edges.at(-1)! / tMin) ** (k / 80);
      path += `${k === 0 ? "M" : "L"}${x(t).toFixed(1)},${y(omoriRate(model, t)).toFixed(1)}`;
    }
  }

  const points: HoverPoint[] = bins.map((b) => ({
    x: x(b.t),
    y: y(b.rate),
    title: `${b.lo.toPrecision(2)}–${b.hi.toPrecision(2)} days after`,
    rows: [
      { label: "per day, observed", value: b.rate.toPrecision(3), color: CHART.observed },
      { label: "events in bin", value: String(b.count), color: CHART.observed },
      ...(model ? [{ label: "per day, Omori-Utsu", value: omoriRate(model, b.t).toPrecision(3), color: CHART.model }] : []),
    ],
  }));

  return (
    <div>
      <Legend
        items={[
          { label: "observed rate", color: CHART.observed, kind: "dot" },
          ...(model ? [{ label: "Omori-Utsu fit, K/(t+c)^p", color: CHART.model, kind: "line" as const }] : []),
        ]}
      />
      <HoverChart testId="chart-decay" ariaLabel="Aftershock rate decay" points={points}>
        <Frame x={x} y={y} xLabel="days after the mainshock (log)" yLabel="events per day (log)">
          {model && <path d={path} fill="none" stroke={CHART.model} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {bins.map((b) => (
            <circle key={b.lo} cx={x(b.t)} cy={y(b.rate)} r={4} fill={CHART.observed} stroke={CHART.surface} strokeWidth={2} />
          ))}
        </Frame>
      </HoverChart>
      {isRefusal(fit) && <p style={{ fontSize: 11, color: "var(--text-dim)" }}>No fit: {fit.reason}</p>}
      <DataTable
        caption="Aftershock rate in log-spaced bins"
        columns={["from (days)", "to (days)", "events", "per day"]}
        rows={bins.map((b) => [b.lo.toPrecision(3), b.hi.toPrecision(3), b.count, b.rate.toPrecision(3)])}
      />
    </div>
  );
}
