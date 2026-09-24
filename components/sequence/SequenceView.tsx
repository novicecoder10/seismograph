"use client";

import { formatDepth, formatMagnitude, formatUtc } from "@/lib/events/format";
import { isRefusal } from "@/lib/science/refusal";
import type { SequenceAnalysis } from "@/lib/science/sequence";
import { CompletenessOverTime } from "./CompletenessOverTime";
import { DecayCurve } from "./DecayCurve";
import { DeclusteringComparison } from "./DeclusteringComparison";
import { FrequencyMagnitude } from "./FrequencyMagnitude";
import { OgataResidual } from "./OgataResidual";
import { Stat, type StatValue } from "./Stat";

const DAY_MS = 86_400_000;

function Panel({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "14px 16px", minWidth: 0 }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, margin: "0 0 2px" }}>{title}</h3>
      <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "0 0 6px" }}>{caption}</p>
      {children}
    </section>
  );
}

const noUncertainty = "the likelihood surface is too flat at the optimum";

export function SequenceView({ analysis, truncated = false }: { analysis: SequenceAnalysis; truncated?: boolean }) {
  const { mainshock, window: w, classification, mc, bValue, omori } = analysis;

  const bStat = (v: typeof bValue.akiUtsu): StatValue =>
    isRefusal(v) ? v : { value: v.b, sigma: v.sigma, ci95: v.ci95 };
  const omoriStat = (key: "p" | "c" | "K"): StatValue => {
    if (isRefusal(omori)) return omori;
    const sigma = omori.sigma?.[key] ?? null;
    return sigma === null
      ? { value: omori[key], sigma: null, why: noUncertainty }
      : { value: omori[key], sigma, ...(key === "p" && omori.ci95P ? { ci95: omori.ci95P } : {}) };
  };
  const mcStat = (v: typeof mc.maxc): StatValue => (isRefusal(v) ? v : { value: v.mc, sigma: v.sigma });

  const aftershockTimes = analysis.aftershocks
    .filter((e) => mc.used !== null && e.magnitude >= mc.used - 1e-9)
    .map((e) => (e.time - mainshock.time) / DAY_MS);
  const endDays = (w.endMs - mainshock.time) / DAY_MS;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <header>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "0 0 4px" }}>
          Sequence of the {formatMagnitude(mainshock.magnitude, null)} of {formatUtc(mainshock.time).slice(0, 10)}
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>
          {mainshock.lat.toFixed(3)}°, {mainshock.lon.toFixed(3)}° · {formatDepth(mainshock.depthKm)} ·{" "}
          {analysis.events.length.toLocaleString()} events of M {w.minMagnitude.toFixed(1)}+ within{" "}
          {w.radiusKm.toFixed(0)} km, {formatUtc(w.startMs).slice(0, 10)} to {formatUtc(w.endMs).slice(0, 10)}
        </p>
        {truncated && (
          <p style={{ fontSize: 12, color: "var(--accent-warn)", margin: "6px 0 0" }}>
            The catalogue query reached its {w.rowLimit.toLocaleString()}-event limit, so this window is
            incomplete and every statistic below is biased toward the events that were returned.
          </p>
        )}
      </header>

      <section data-testid="classification" style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "12px 16px" }}>
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>classification</div>
        <div style={{ fontSize: 17, margin: "2px 0 6px" }}>{classification.kind}</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-dim)" }}>
          {classification.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))", gap: 10 }}>
        <Stat testId="stat-b-aki-utsu" label="b-value, Aki-Utsu (Shi-Bolt σ)" symbol="b" stat={bStat(bValue.akiUtsu)} />
        <Stat testId="stat-b-positive" label="b-value, b-positive (van der Elst)" symbol="b⁺" stat={bStat(bValue.bPositive)} />
        <Stat testId="stat-mc-maxc" label="completeness, MAXC + 0.2" symbol="Mc" stat={mcStat(mc.maxc)} digits={1} />
        <Stat testId="stat-mc-gft" label="completeness, goodness of fit" symbol="Mc" stat={mcStat(mc.gft)} digits={1} />
        <Stat testId="stat-omori-p" label="Omori-Utsu decay exponent" symbol="p" stat={omoriStat("p")} />
        <Stat testId="stat-omori-c" label="Omori-Utsu time offset" symbol="c" stat={omoriStat("c")} digits={3} unit=" d" />
        <Stat testId="stat-omori-k" label="Omori-Utsu productivity" symbol="K" stat={omoriStat("K")} digits={1} />
      </div>

      <p style={{ fontSize: 11, color: "var(--text-dim)", margin: 0 }}>
        {mc.used === null
          ? "Neither completeness estimate could be made, so no statistic that depends on it is shown."
          : `Statistics above completeness use the larger of the two Mc estimates, M ${mc.used.toFixed(1)}: the conservative choice.`}
        {!isRefusal(bValue.akiUtsu) && !isRefusal(bValue.bPositive) &&
          " Where the two b-values disagree, b-positive is the one that resists the short-lived incompleteness after a large event; a narrow interval on Aki-Utsu does not rule out bias."}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 14 }}>
        <Panel title="Frequency-magnitude distribution" caption="Gutenberg-Richter is a straight line on these axes; the curve bends over below completeness.">
          <FrequencyMagnitude bins={analysis.bins} cumulative={analysis.cumulative} mc={mc.used} b={bValue.akiUtsu} />
        </Panel>
        <Panel title="Aftershock decay" caption="Rate in log-spaced bins after the mainshock, above completeness. Fitted from t = 0, where early incompleteness inflates c.">
          <DecayCurve timesDays={aftershockTimes} endDays={endDays} fit={omori} />
        </Panel>
        <Panel title="Does the decay law hold?" caption="Ogata's residual test: under the fitted model the observed count follows the diagonal.">
          <OgataResidual result={analysis.ogata} />
        </Panel>
        <Panel title="Completeness through time" caption="Detection changes over a sequence: early aftershocks are buried in the coda of larger ones.">
          <CompletenessOverTime series={analysis.mcOverTime} />
        </Panel>
      </div>

      <DeclusteringComparison d={analysis.declustering} />

      {analysis.mcSpatial.length > 0 && (
        <Panel title="Completeness in space" caption="0.25° cells with at least 50 events. A higher Mc marks a less densely instrumented area.">
          <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["cell centre", "Mc", "σ", "events"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 12px 4px 0", color: "var(--text-dim)", fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.mcSpatial.map((c) => (
                <tr key={`${c.lat}:${c.lon}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                  <td style={{ padding: "2px 12px 2px 0" }}>{c.lat.toFixed(2)}°, {c.lon.toFixed(2)}°</td>
                  <td style={{ padding: "2px 12px 2px 0" }}>{c.mc.toFixed(1)}</td>
                  <td style={{ padding: "2px 12px 2px 0" }}>± {c.sigma.toFixed(2)}</td>
                  <td style={{ padding: "2px 12px 2px 0" }}>{c.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <p style={{ fontSize: 11, color: "var(--text-faint)", margin: 0 }}>
        This page describes what the sequence has done. It makes no statement about what it will do.
      </p>
    </div>
  );
}
