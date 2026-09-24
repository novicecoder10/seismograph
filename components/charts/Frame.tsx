import type { Scale } from "@/lib/charts/scales";
import { CHART, VIEW } from "./theme";

export interface FrameProps {
  x: Scale;
  y: Scale;
  xLabel: string;
  yLabel: string;
  /** Formats x ticks; defaults to the scale's own formatter. */
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** viewBox height when it is not the default VIEW. */
  height?: number;
  children: React.ReactNode;
}

/** Axes, hairline grid and labels. Solid one-step-off-surface hairlines, never
 *  dashed; tick text in text tokens. */
export function Frame({ x, y, xLabel, yLabel, xFormat, yFormat, height = VIEW.height, children }: FrameProps) {
  const fmtX = xFormat ?? x.format;
  const fmtY = yFormat ?? y.format;
  const bottom = height - VIEW.bottom;
  return (
    <>
      {y.ticks.map((t) => (
        <g key={`y${t}`}>
          <line x1={VIEW.left} x2={VIEW.width - VIEW.right} y1={y(t)} y2={y(t)} stroke={CHART.grid} strokeWidth={1} />
          <text x={VIEW.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHART.textSecondary}
            style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmtY(t)}
          </text>
        </g>
      ))}
      {x.ticks.map((t) => (
        <g key={`x${t}`}>
          <line x1={x(t)} x2={x(t)} y1={VIEW.top} y2={bottom} stroke={CHART.grid} strokeWidth={1} />
          <text x={x(t)} y={bottom + 16} textAnchor={x(t) > VIEW.width - VIEW.right - 36 ? "end" : "middle"} fontSize={11} fill={CHART.textSecondary}
            style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmtX(t)}
          </text>
        </g>
      ))}
      <text x={(VIEW.left + VIEW.width - VIEW.right) / 2} y={height - 6} textAnchor="middle" fontSize={11}
        fill={CHART.textSecondary}>
        {xLabel}
      </text>
      <text transform={`translate(13 ${(VIEW.top + bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11}
        fill={CHART.textSecondary}>
        {yLabel}
      </text>
      {children}
    </>
  );
}
