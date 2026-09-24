"use client";

import { linearScale } from "@/lib/charts/scales";
import type { OgataResult } from "@/lib/science/omori";
import { DataTable } from "../charts/DataTable";
import { Frame } from "../charts/Frame";
import { HoverChart, type HoverPoint } from "../charts/HoverChart";
import { Legend } from "../charts/Legend";
import { CHART, VIEW } from "../charts/theme";

/**
 * Ogata's transformed-time residual plot. If the Omori-Utsu model is right,
 * the cumulative count against transformed time follows the diagonal. A
 * secondary burst shows as a step above it; quiescence as a flattening below.
 */
export function OgataResidual({ result }: { result: OgataResult | null }) {
  if (result === null || result.points.length === 0) {
    return (
      <p data-testid="chart-ogata" style={{ color: "var(--text-dim)", fontSize: 12 }}>
        No Omori-Utsu fit, so there is nothing to test the sequence against.
      </p>
    );
  }
  const n = result.points.length;
  const total = Math.max(result.total, n);
  const x = linearScale([0, total], [VIEW.left, VIEW.width - VIEW.right], 5);
  const y = linearScale([0, total], [VIEW.height - VIEW.bottom, VIEW.top], 5);
  const band = result.ksCritical95 * n;

  let step = `M${x(0)},${y(0)}`;
  for (const p of result.points) step += `H${x(p.tau).toFixed(1)}V${y(p.index).toFixed(1)}`;
  const bandPath =
    `M${x(0)},${y(Math.min(total, band))}L${x(total)},${y(total)}` +
    `L${x(total)},${y(Math.max(0, total - band))}L${x(Math.min(total, band))},${y(0)}L${x(0)},${y(0)}Z`;

  const stride = Math.max(1, Math.floor(n / 200));
  const points: HoverPoint[] = result.points
    .filter((_, i) => i % stride === 0 || i === n - 1)
    .map((p) => ({
      x: x(p.tau),
      y: y(p.index),
      title: `event ${p.index} of ${n}`,
      rows: [
        { label: "observed count", value: String(p.index), color: CHART.observed },
        { label: "model's transformed time", value: p.tau.toFixed(1), color: CHART.model },
        { label: "departure", value: (p.index - p.tau).toFixed(1), color: CHART.textMuted },
      ],
    }));

  return (
    <div>
      <Legend
        items={[
          { label: "observed", color: CHART.observed, kind: "line" },
          { label: "model: the diagonal", color: CHART.model, kind: "line" },
          { label: "95% band", color: CHART.model, kind: "band" },
        ]}
      />
      <HoverChart testId="chart-ogata" ariaLabel="Ogata transformed-time residuals" points={points}>
        <Frame x={x} y={y} xLabel="transformed time τ (model-expected count)" yLabel="observed cumulative count">
          <path d={bandPath} fill={CHART.model} opacity={0.1} />
          <line x1={x(0)} y1={y(0)} x2={x(total)} y2={y(total)} stroke={CHART.model} strokeWidth={2} strokeLinecap="round" />
          <path d={step} fill="none" stroke={CHART.observed} strokeWidth={2} strokeLinejoin="round" />
        </Frame>
      </HoverChart>
      <p style={{ fontSize: 12, color: result.consistent ? "var(--text-dim)" : "var(--accent-warn)", margin: "6px 0 0" }}>
        {result.consistent
          ? `Consistent with the Omori-Utsu model: the largest departure (KS D = ${result.ks.toFixed(3)}) is inside the 95% critical value of ${result.ksCritical95.toFixed(3)}.`
          : `Not consistent with a single Omori-Utsu decay: KS D = ${result.ks.toFixed(3)} exceeds the 95% critical value of ${result.ksCritical95.toFixed(3)}. Look for a secondary sequence or a change in completeness where the curve leaves the band.`}
      </p>
      <DataTable
        caption="Transformed times"
        columns={["event", "τ", "departure"]}
        rows={result.points.filter((_, i) => i % stride === 0).map((p) => [p.index, p.tau.toFixed(2), (p.index - p.tau).toFixed(2)])}
      />
    </div>
  );
}
