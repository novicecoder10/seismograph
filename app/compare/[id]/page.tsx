import Link from "next/link";
import { Ask } from "@/components/analyst/Ask";
import { Prose } from "@/components/analyst/Prose";
import { buildBundle, type Comparison } from "@/lib/analyst/bundle";
import { loadLibrary, loadTarget } from "@/lib/analyst/load";
import { renderTemplate } from "@/lib/analyst/template";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";

export const revalidate = 600;
const repo = createUsgsFdsnRepository();

const cell = { padding: "6px 10px", borderBottom: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" as const, textAlign: "left" as const, verticalAlign: "top" as const };
const head = { ...cell, color: "var(--text-dim)", fontWeight: 500 };

function Table({ rows, testId }: { rows: Comparison[]; testId: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table data-testid={testId} style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <thead><tr>{["past sequence", "mainshock", "largest aftershock by then", "this sequence is…", "what followed, to one year"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.key}>
              <td style={cell}><Link href={`/event/${encodeURIComponent(c.key)}`} style={{ color: "var(--text-primary)" }}>{c.name}</Link> ({c.year})</td>
              <td style={cell}>{c.mag}</td>
              <td style={cell}>{c.largestSoFar}</td>
              <td style={cell}>{c.direction}</td>
              <td style={cell}>
                {c.next.count} more M 4.5+; largest {c.next.largest}{c.next.when ? `, ${c.next.when}` : ""}
                {c.next.largerFollowed && <span style={{ display: "block", color: "var(--text-primary)" }}>an earthquake at least as large as the mainshock followed</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const event = await repo.byId(decoded).catch(() => null);
  let body: React.ReactNode;
  if (!event) {
    body = <p style={{ color: "var(--text-dim)" }}>No event with the identifier <code>{decoded}</code> could be retrieved.</p>;
  } else {
    let bundle;
    try {
      bundle = buildBundle(await loadTarget(event, repo, Date.now()), loadLibrary(), Date.now());
    } catch (e) {
      bundle = null;
      body = <p style={{ color: "var(--accent-warn)" }}>The catalogue could not be fetched ({e instanceof Error ? e.message : String(e)}), so no comparison is made.</p>;
    }
    if (bundle) {
      const t = bundle.target;
      body = (
        <div style={{ display: "grid", gap: 14 }}>
          <header>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "0 0 4px" }}>How this sequence compares with past ones</h2>
            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>The {t.mag} of {t.date}, {t.place}</p>
          </header>
          {bundle.limited ? (
            <p data-testid="compare-limited" style={{ fontSize: 13, color: "var(--text-dim)", maxWidth: 760 }}>{bundle.limited}</p>
          ) : (
            <>
              <section data-testid="compare-facts" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 10 }}>
                {[["time since the mainshock", t.elapsed], ["aftershocks of M 4.5+", t.count], ["largest aftershock", t.largest], ["M 4.5+ in the 30 days before", t.foreshocks]].map(([k, v]) => (
                  <div key={k} style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{k}</div>
                    <div style={{ fontSize: 17, color: "var(--text-primary)" }}>{v}</div>
                  </div>
                ))}
              </section>
              <section style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "12px 14px" }}>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, margin: "0 0 8px" }}>Most alike at {t.elapsed}</h3>
                <Table rows={bundle.most} testId="compare-most" />
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, margin: "14px 0 8px" }}>Least alike</h3>
                <Table rows={bundle.least} testId="compare-least" />
                <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "10px 0 0" }}>
                  Of the {bundle.base.libraryCount} past sequences compared, {bundle.base.largerFollowedCount} had an earthquake at least as large as their mainshock after this point.
                </p>
              </section>
              <section style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "12px 14px" }}>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, margin: "0 0 8px" }}>In words</h3>
                <Prose eventId={event.id} template={renderTemplate(bundle)} />
              </section>
              <Ask eventId={event.id} />
            </>
          )}
          <section style={{ fontSize: 11, color: "var(--text-dim)" }}>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {bundle.caveats.map((c) => <li key={c}>{c}</li>)}
              <li>Catalogue: {bundle.provenance.catalogue}, {bundle.provenance.floor} and larger within {bundle.provenance.radius}; computed {bundle.provenance.computedAt}.</li>
              <li>For probabilities of aftershocks, see the <Link href={`/forecast/${encodeURIComponent(event.id)}`} style={{ color: "var(--text-primary)" }}>aftershock forecast</Link>.</li>
            </ul>
          </section>
        </div>
      );
    }
  }
  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "22px 22px 60px" }}>
      <Link href={`/event/${encodeURIComponent(decoded)}`} style={{ color: "var(--text-dim)", fontSize: 12 }}>← back to the event</Link>
      <div style={{ marginTop: 18 }}>{body}</div>
    </main>
  );
}
