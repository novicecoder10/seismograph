import Link from "next/link";
import { formatUtc } from "@/lib/events/format";
import type { Scoreboard } from "@/lib/ledger/summary";
import { MIN_FOR_VERDICT } from "@/lib/ledger/summary";
import { Reliability } from "./Reliability";

const cell = { padding: "6px 10px", borderBottom: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" as const, textAlign: "left" as const };
const head = { ...cell, color: "var(--text-dim)", fontWeight: 500 };

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "14px 16px", minWidth: 0 }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, margin: "0 0 8px" }}>{title}</h3>
      {children}
    </section>
  );
}

function headline(sb: Scoreboard): { text: string; warn: boolean } {
  const ig = sb.informationGain;
  const igText = ig ? `${ig.mean.toFixed(2)} (95%: ${ig.ci95[0].toFixed(2)} to ${ig.ci95[1].toFixed(2)})` : "";
  switch (sb.verdict) {
    case "none-scored":
      return {
        text: sb.pending.nextScoredAt
          ? `No forecast has been scored yet. The first window is scored ${formatUtc(sb.pending.nextScoredAt)}.`
          : "No forecast has been issued yet.",
        warn: false,
      };
    case "too-few":
      return { text: `${sb.scored} forecasts scored: too few to judge (a verdict needs ${MIN_FOR_VERDICT}). Information gain over the baseline so far: ${igText} per forecast.`, warn: false };
    case "beats":
      return { text: `The model beats the long-term baseline: information gain ${igText} per forecast over ${sb.scored} scored forecasts.`, warn: false };
    case "does-not-beat":
      return { text: `The model does not beat the long-term baseline. Information gain is ${igText} per forecast over ${sb.scored} scored forecasts: the region's average rate has forecast better than this model.`, warn: true };
    case "indistinguishable":
      return { text: `The model has not been shown to beat the long-term baseline: information gain ${igText} per forecast over ${sb.scored} scored forecasts, an interval that includes zero.`, warn: true };
  }
}

export function ScoreboardView({ sb }: { sb: Scoreboard }) {
  const h = headline(sb);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <header>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "0 0 6px" }}>Forecast scoreboard</h2>
        <p data-testid="scoreboard-verdict" style={{ fontSize: 15, margin: 0, maxWidth: 780, color: h.warn ? "var(--accent-warn)" : "var(--text-primary)" }}>
          {h.text}
        </p>
      </header>

      <p data-testid="scoreboard-integrity" style={{ fontSize: 12, color: sb.integrity.problem ? "var(--accent-warn)" : "var(--text-dim)", margin: 0, maxWidth: 780 }}>
        {sb.integrity.problem ??
          `Ledger intact: ${sb.integrity.forecasts} forecasts and ${sb.integrity.scores} scores, each line chained to the one before by SHA-256, so no past entry can be edited, removed or reordered without breaking every hash after it.`}{" "}
        Forecasts are recorded before their windows open; each carries the baseline it will be judged against.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 14 }}>
        <Section title="Are the probabilities honest?" testId="scoreboard-calibration">
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 6px" }}>
            Forecasts grouped by the chance they gave of at least one aftershock, against how often one occurred.
          </p>
          <Reliability bins={sb.calibration} />
        </Section>
        <Section title="Consistency and skill" testId="scoreboard-metrics">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.8 }}>
            <li>
              N-test (is the observed count plausible under the forecast?): {sb.nTest.passed} of {sb.nTest.total} passed
              {sb.nTest.total > 0 && ` (${((sb.nTest.passed / sb.nTest.total) * 100).toFixed(0)}%, 95%: ${(sb.nTest.ci95[0] * 100).toFixed(0)}–${(sb.nTest.ci95[1] * 100).toFixed(0)}%)`}. A calibrated
              model passes about 95%.
            </li>
            {sb.logLoss && (
              <li>
                Mean log-loss of “at least one” (lower is better): model {sb.logLoss.model.toFixed(3)}, baseline {sb.logLoss.baseline.toFixed(3)}.
              </li>
            )}
            <li>
              Information gain: the log of how much more probable the model made what actually happened than the
              baseline did. Positive means the model did better.
            </li>
            <li>
              Baseline: the 20-year average rate of M 4.6+ earthquakes in the same circle, ending 30 days before the
              mainshock, as a Poisson rate — what the region usually does.
            </li>
            <li>
              Scored magnitudes: M 5, 6, 7 and the mainshock's own. Smaller ones are forecast but not scored, because the
              global catalogue misses many of them.
            </li>
            <li>Pending: {sb.pending.windows} windows not yet closed.</li>
          </ul>
        </Section>
      </div>

      <Section title={`Failures (${sb.failures.length})`} testId="scoreboard-failures">
        {sb.failures.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>
            {sb.scored === 0 ? "Nothing has been scored yet." : "No scored forecast has failed its N-test."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
              <thead><tr>{["earthquake", "window", "magnitude", "observed", "expected", "why it failed"].map((c) => <th key={c} style={head}>{c}</th>)}</tr></thead>
              <tbody>
                {sb.failures.map((s) => (
                  <tr key={`${s.forecastId}|${s.window}|${s.magnitude}`}>
                    <td style={cell}>M {s.magMain.toFixed(1)} {s.place}</td>
                    <td style={cell}>{s.window}</td>
                    <td style={cell}>M {s.magnitude.toFixed(1)}+</td>
                    <td style={cell}>{s.observed}</td>
                    <td style={cell}>{s.expected.toPrecision(2)}</td>
                    <td style={cell}>{s.pAtLeast < 0.025 ? "more happened than forecast" : "fewer happened than forecast"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Forecasts issued (${sb.forecasts.length})`} testId="scoreboard-forecasts">
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
            <thead><tr>{["issued", "earthquake", "aftershocks used", "baseline events (20 yr)"].map((c) => <th key={c} style={head}>{c}</th>)}</tr></thead>
            <tbody>
              {sb.forecasts.slice(0, 200).map((f) => (
                <tr key={f.id}>
                  <td style={cell}>{formatUtc(f.issuedAt)}</td>
                  <td style={cell}>
                    <Link href={`/forecast/${encodeURIComponent(f.eventId)}`} style={{ color: "var(--text-primary)" }}>M {f.magMain.toFixed(1)} {f.place}</Link>
                  </td>
                  <td style={cell}>{f.aftershocksUsed}</td>
                  <td style={cell}>{f.baseline.count}{f.baseline.truncated ? "+" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
