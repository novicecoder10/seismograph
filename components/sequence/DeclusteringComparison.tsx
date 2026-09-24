import type { SequenceAnalysis } from "@/lib/science/sequence";

const cell = { padding: "6px 10px", borderBottom: "1px solid var(--line)" } as const;

/** Both methods, side by side, always. Their disagreement is information about
 *  the sequence, not an error to be resolved by picking one (spec §5). */
export function DeclusteringComparison({ d }: { d: SequenceAnalysis["declustering"] }) {
  const gk = d.gardnerKnopoff;
  const zbz = d.zaliapin;
  const rows: [string, string | number, string | number][] = [
    ["events assigned to this mainshock", gk.mainshockClusterSize, zbz.mainshockClusterSize],
    ["clusters found in the window", gk.clusters, zbz.clusters],
    ["events judged independent", gk.independent, zbz.independent],
  ];
  return (
    <section data-testid="declustering" style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "14px 16px" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, margin: "0 0 6px" }}>Which events belong to this sequence?</h3>
      <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "0 0 10px" }}>
        Two published methods answer differently, and the difference is shown rather than hidden.
        Gardner-Knopoff draws a fixed space-time window scaled by the mainshock&apos;s magnitude.
        Zaliapin-Ben-Zion links each event to its nearest predecessor in a rescaled space-time
        distance, so it can follow a sequence that migrates beyond any fixed window.
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: "left", color: "var(--text-dim)", fontWeight: 500 }} />
            <th style={{ ...cell, textAlign: "right", color: "var(--text-dim)", fontWeight: 500 }}>Gardner-Knopoff (1974)</th>
            <th style={{ ...cell, textAlign: "right", color: "var(--text-dim)", fontWeight: 500 }}>Zaliapin &amp; Ben-Zion (2013)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label}>
              <td style={{ ...cell, color: "var(--text-dim)" }}>{label}</td>
              <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.toLocaleString()}</td>
              <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "10px 0 0" }}>
        Both methods assign {d.agreement.both.toLocaleString()} events to this mainshock;{" "}
        {d.agreement.onlyGk.toLocaleString()} only by Gardner-Knopoff and{" "}
        {d.agreement.onlyZbz.toLocaleString()} only by Zaliapin-Ben-Zion.
      </p>
      {zbz.restrictedAboveMagnitude !== null && (
        <p style={{ fontSize: 11, color: "var(--accent-warn)", margin: "6px 0 0" }}>
          The nearest-neighbour method compares every pair of events, so it was run on the events of
          M {zbz.restrictedAboveMagnitude.toFixed(1)} and above only.
        </p>
      )}
    </section>
  );
}
