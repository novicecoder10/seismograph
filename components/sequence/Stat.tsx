import { isRefusal, type Refusal } from "@/lib/science/refusal";

export type StatValue =
  | { value: number; sigma: number; ci95?: [number, number] }
  | { value: number; sigma: null; why: string }
  | Refusal;

export interface StatProps {
  testId: string;
  label: string;
  symbol: string;
  stat: StatValue;
  digits?: number;
  unit?: string;
}

/**
 * Renders a statistic WITH its uncertainty, or the reason it was refused.
 * There is deliberately no way to render a bare number: spec §10.11, "every
 * displayed statistic carries its uncertainty".
 */
export function Stat({ testId, label, symbol, stat, digits = 2, unit = "" }: StatProps) {
  const f = (v: number) => v.toFixed(digits);
  let body: React.ReactNode;
  if (isRefusal(stat)) {
    body = <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{stat.reason}</span>;
  } else if (stat.sigma === null) {
    body = (
      <>
        <span style={{ fontSize: 17, color: "var(--text-primary)" }}>
          {symbol} = {f(stat.value)}
          {unit}
        </span>
        <span style={{ display: "block", fontSize: 11, color: "var(--accent-warn)" }}>
          uncertainty not estimable: {stat.why}
        </span>
      </>
    );
  } else {
    body = (
      <>
        <span style={{ fontSize: 17, color: "var(--text-primary)" }}>
          {symbol} = {f(stat.value)} ± {stat.sigma.toFixed(Math.max(digits, 2))}
          {unit}
        </span>
        {stat.ci95 && (
          <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>
            95%: {f(stat.ci95[0])}–{f(stat.ci95[1])}
          </span>
        )}
      </>
    );
  }
  return (
    <div
      data-testid={testId}
      style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "10px 12px", minWidth: 0 }}
    >
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>{label}</div>
      {body}
    </div>
  );
}
