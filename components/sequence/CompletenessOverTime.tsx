"use client";

import { formatUtc } from "@/lib/events/format";
import { linearScale } from "@/lib/charts/scales";
import { DataTable } from "../charts/DataTable";
import { Frame } from "../charts/Frame";
import { HoverChart, type HoverPoint } from "../charts/HoverChart";
import { Legend } from "../charts/Legend";
import { CHART, VIEW } from "../charts/theme";

type McPoint = { timeMs: number; mc: number; sigma: number; n: number };

const day = (ms: number) => formatUtc(ms).slice(0, 10);

/** Mc(t): what inoculates a reader against "earthquakes are increasing". A
 *  falling Mc means the network got more sensitive, not the Earth busier. */
export function CompletenessOverTime({ series }: { series: McPoint[] }) {
  if (series.length < 2) {
    return (
      <p data-testid="chart-mc-time" style={{ color: "var(--text-dim)", fontSize: 12 }}>
        Too few events to track completeness through time — at least two windows of 100 events are
        needed.
      </p>
    );
  }
  const t0 = series[0]!.timeMs;
  const t1 = series.at(-1)!.timeMs;
  const lo = Math.min(...series.map((s) => s.mc - s.sigma)) - 0.2;
  const hi = Math.max(...series.map((s) => s.mc + s.sigma)) + 0.2;
  const x = linearScale([t0, t1 === t0 ? t0 + 1 : t1], [VIEW.left, VIEW.width - VIEW.right]);
  // Time ticks: five evenly spaced instants, labelled as UTC dates.
  x.ticks = Array.from({ length: 5 }, (_, i) => t0 + ((t1 - t0) * i) / 4);
  const y = linearScale([lo, hi], [VIEW.height - VIEW.bottom, VIEW.top], 5);

  const line = series.map((s, i) => `${i === 0 ? "M" : "L"}${x(s.timeMs).toFixed(1)},${y(s.mc).toFixed(1)}`).join("");
  const band =
    series.map((s, i) => `${i === 0 ? "M" : "L"}${x(s.timeMs).toFixed(1)},${y(s.mc + s.sigma).toFixed(1)}`).join("") +
    [...series].reverse().map((s) => `L${x(s.timeMs).toFixed(1)},${y(s.mc - s.sigma).toFixed(1)}`).join("") +
    "Z";

  const points: HoverPoint[] = series.map((s) => ({
    x: x(s.timeMs),
    y: y(s.mc),
    title: formatUtc(s.timeMs),
    rows: [{ label: `Mc over ${s.n} events`, value: `${s.mc.toFixed(1)} ± ${s.sigma.toFixed(2)}`, color: CHART.observed }],
  }));

  return (
    <div>
      <Legend
        items={[
          { label: "Mc (MAXC + 0.2)", color: CHART.observed, kind: "line" },
          { label: "± 1σ bootstrap", color: CHART.observed, kind: "band" },
        ]}
      />
      <HoverChart testId="chart-mc-time" ariaLabel="Magnitude of completeness over time" points={points}>
        <Frame x={x} y={y} xFormat={day} xLabel="date (UTC)" yLabel="magnitude of completeness">
          <path d={band} fill={CHART.observed} opacity={0.1} />
          <path d={line} fill="none" stroke={CHART.observed} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </Frame>
      </HoverChart>
      <DataTable
        caption="Magnitude of completeness in moving windows"
        columns={["window centre (UTC)", "Mc", "σ", "events"]}
        rows={series.map((s) => [formatUtc(s.timeMs), s.mc.toFixed(1), s.sigma.toFixed(2), s.n])}
      />
    </div>
  );
}
