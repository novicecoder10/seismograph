import { formatMagnitude, formatUtc } from "@/lib/events/format";
import type { Event } from "@/lib/events/types";
import { isRjParameters, type OafForecast } from "@/lib/oaf/types";
import type { ForecastResult } from "@/lib/repositories/forecast";
import { formatProbability, formatRange } from "./format";

const cell = { padding: "7px 10px", borderBottom: "1px solid var(--line)", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const };
const head = { ...cell, color: "var(--text-dim)", fontWeight: 500 };

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "14px 16px", minWidth: 0 }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, margin: "0 0 8px" }}>{title}</h3>
      {children}
    </section>
  );
}

/** Magnitude × window: chance of at least one, and the 95% range of the count. */
function ForecastTable({ f }: { f: OafForecast }) {
  const mags = f.forecast[0]?.bins.map((b) => b.magnitude) ?? [];
  return (
    <div style={{ overflowX: "auto" }}>
      <table data-testid="forecast-table" style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: 460 }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "left" }}>magnitude</th>
            {f.forecast.map((w) => (
              <th key={w.label} style={head}>next {w.label.toLowerCase().replace(/^1 /, "")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mags.map((m, i) => (
            <tr key={m}>
              <td style={{ ...cell, textAlign: "left", color: "var(--text-dim)" }}>M {m.toFixed(0)} or larger</td>
              {f.forecast.map((w) => {
                const b = w.bins[i]!;
                return (
                  <td key={w.label} style={cell}>
                    <span style={{ color: "var(--text-primary)" }}>{formatProbability(b.probability)}</span>
                    <span style={{ display: "block", fontSize: 10, color: "var(--text-dim)" }}>
                      {formatRange(b.p95minimum, b.p95maximum)} {b.p95maximum === 1 && b.p95minimum === 1 ? "event" : "events"}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Larger({ f, baseline, magnitude }: { f: OafForecast; baseline: OafForecast | null; magnitude: number }) {
  return (
    <Section title={`An earthquake of M ${magnitude.toFixed(1)} or larger`} testId="forecast-larger">
      <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 8px" }}>
        The chance that this earthquake is followed by one at least as large. It is small, and it
        is shown as the small number it is.
        {baseline && " Beside it is the same figure for a typical sequence of this size in this tectonic setting, before any of this sequence's own aftershocks are counted."}
      </p>
      <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "left" }}>window</th>
            <th style={head}>this sequence</th>
            {baseline && <th style={head}>typical sequence</th>}
          </tr>
        </thead>
        <tbody>
          {f.forecast.map((w, i) => (
            <tr key={w.label}>
              <td style={{ ...cell, textAlign: "left", color: "var(--text-dim)" }}>next {w.label.toLowerCase().replace(/^1 /, "")}</td>
              <td style={cell}>{formatProbability(w.aboveMainshockMag.probability)}</td>
              {baseline && <td style={{ ...cell, color: "var(--text-dim)" }}>{formatProbability(baseline.forecast[i]!.aboveMainshockMag.probability)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Model({ f, extra }: { f: OafForecast; extra: React.ReactNode }) {
  const p = f.model.parameters;
  const w = f.forecast[0];
  const region =
    typeof p.regionRadius === "number" && typeof p.regionCenterLat === "number" && typeof p.regionCenterLon === "number" ? (
      <li>
        Aftershocks counted within {p.regionRadius.toFixed(0)} km of {p.regionCenterLat.toFixed(2)}°, {p.regionCenterLon.toFixed(2)}°.
      </li>
    ) : null;
  const timing = w && <li>Windows begin {formatUtc(w.timeStart)}; issued {formatUtc(f.creationTime)}.</li>;

  if (!isRjParameters(p)) {
    const shown = Object.entries(p).filter(([k, v]) => typeof v === "number" && !k.startsWith("region"));
    return (
      <Section title="How this was calculated" testId="forecast-model">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.7 }}>
          <li>{f.model.name}, as published by USGS.</li>
          {shown.length > 0 && (
            <li style={{ fontVariantNumeric: "tabular-nums" }}>
              {shown.map(([k, v]) => `${k} = ${(v as number).toPrecision(3)}`).join(" · ")}
            </li>
          )}
          {region}
          {timing}
          {extra}
        </ul>
      </Section>
    );
  }

  return (
    <Section title="How this was calculated" testId="forecast-model">
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.7 }}>
        <li>{f.model.name}: the aftershock rate decays as (t + c)<sup>−p</sup> and scales as 10<sup>a + b(M<sub>main</sub> − M)</sup>.</li>
        <li style={{ fontVariantNumeric: "tabular-nums" }}>
          a = {p.a.toFixed(2)} ± {p.aSigma.toFixed(2)} · p = {p.p.toFixed(2)}
          {p.pSigma > 0 ? ` ± ${p.pSigma.toFixed(2)}` : " (regional value, held fixed)"} · c = {p.c.toFixed(3)} d · b = {p.b.toFixed(2)}
        </li>
        <li>
          Probabilities integrate over the uncertainty in these parameters rather than using a single best
          value, so the ranges are wider than a Poisson count would suggest.
        </li>
        <li>
          Completeness: the catalogue is taken as complete above M {p.Mcat.toFixed(1)}, raised just after the
          mainshock as M<sub>c</sub>(t) = {p.F}·M<sub>main</sub> − {p.G} − {p.H}·log₁₀ t (Page et al. 2016).
          {p.Mcat > 3 && ` Figures for magnitudes below M ${p.Mcat.toFixed(1)} are extrapolated with b = ${p.b.toFixed(1)}, not observed.`}
        </li>
        {region}
        {timing}
        {extra}
      </ul>
    </Section>
  );
}

function Header({ event }: { event: Event }) {
  return (
    <header>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "0 0 4px" }}>
        Aftershock forecast: {formatMagnitude(event.magnitude, event.magType)}
      </h2>
      <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>
        {event.place} · {formatUtc(event.time)}
      </p>
    </header>
  );
}

export function ForecastView({ result }: { result: ForecastResult }) {
  const { event } = result;
  if (result.kind === "refused") {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <Header event={event} />
        <p data-testid="forecast-refused" style={{ fontSize: 13, color: "var(--text-dim)", maxWidth: 680 }}>
          No forecast is issued for this earthquake. {result.reason}
        </p>
      </div>
    );
  }

  const f = result.kind === "usgs" ? result.published : result.forecast;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Header event={event} />

      <p data-testid="forecast-source" style={{ fontSize: 12, color: "var(--text-dim)", margin: 0, maxWidth: 760 }}>
        {result.kind === "usgs" ? (
          <>
            <strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>Published by USGS.</strong> This is the
            U.S. Geological Survey&apos;s operational aftershock forecast, shown unchanged.{" "}
            <span data-testid="reproduction">
              {result.reproduction
                ? `Recomputed here from USGS's own inputs (${result.reproduction.n.toLocaleString()} aftershocks), every published probability agrees within ${(result.reproduction.maxRelError * 100).toFixed(2)}%.`
                : result.reproductionNote}
            </span>
          </>
        ) : (
          <>
            <strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>Computed here.</strong> USGS has not issued a
            forecast for this earthquake, so this one applies USGS&apos;s method, with the generic parameters USGS
            uses for this tectonic setting ({result.regime.description}), updated by the{" "}
            {result.posterior.n === 1 ? "1 aftershock" : `${result.posterior.n} aftershocks`} recorded above completeness so far.
            The method reproduces USGS&apos;s published forecasts to within 0.2% where both exist.
          </>
        )}
      </p>

      <Section title="Chance of at least one aftershock" testId="forecast-probabilities">
        <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 8px" }}>
          Each cell: the chance of one or more earthquakes of at least that magnitude in the window, and below it
          the range the number of such earthquakes falls in 95% of the time.
        </p>
        <ForecastTable f={f} />
      </Section>

      <Larger f={f} baseline={result.kind === "computed" ? result.baseline : null} magnitude={event.magnitude} />

      <Model
        f={f}
        extra={
          result.kind === "computed" ? (
            <>
              <li>Tectonic setting: {result.regime.description} (Garcia et al. 2012 regime {result.regime.code}).</li>
              {event.depthKm !== null && event.depthKm > 70 && (
                <li>
                  This earthquake was {event.depthKm.toFixed(0)} km deep. Intermediate and deep earthquakes usually have
                  far fewer aftershocks than shallow ones, while the generic parameters for a setting are drawn mostly
                  from shallow sequences; the forecast moves down only as fast as the absence of aftershocks can show.
                </li>
              )}
              {result.posterior.edgeMass > 0.01 && (
                <li style={{ color: "var(--accent-warn)" }}>
                  {(result.posterior.edgeMass * 100).toFixed(0)}% of the probability for a lies at the edge of the range
                  searched, so these figures are bounded by the model&apos;s limits rather than by the data.
                </li>
              )}
              {result.truncated && (
                <li style={{ color: "var(--accent-warn)" }}>
                  The catalogue query reached its row limit; some aftershocks were not counted.
                </li>
              )}
            </>
          ) : null
        }
      />

      <p style={{ fontSize: 11, color: "var(--text-faint)", margin: 0, maxWidth: 760 }}>
        A forecast is a statement of chances, not a warning. Nobody can say when, where or how large the next
        earthquake will be, only how often earthquakes like it have followed sequences like this one. For safety guidance, follow your local civil-protection authority.
      </p>
    </div>
  );
}
