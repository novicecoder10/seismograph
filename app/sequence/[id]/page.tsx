import Link from "next/link";
import { SequenceView } from "@/components/sequence/SequenceView";
import { Ask } from "@/components/analyst/Ask";
import { Prose } from "@/components/analyst/Prose";
import { sequenceEvidence, sequenceTemplate } from "@/lib/analyst/facts";
import { loadSequence } from "@/lib/repositories/sequence";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";

const repo = createUsgsFdsnRepository();

/** Declustering is O(n²) on up to 3000 events: run it once per sequence per ten
 *  minutes, not once per visitor. */
export const revalidate = 600;

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const [result, event] = await Promise.all([loadSequence(decoded, { fdsn: repo }), repo.byId(decoded).catch(() => null)]);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 22px 60px" }}>
      <Link href={`/event/${encodeURIComponent(decoded)}`} style={{ color: "var(--text-dim)", fontSize: 12 }}>
        ← back to the event
      </Link>
      <div style={{ marginTop: 18 }}>
        {"error" in result ? (
          <p data-testid="sequence-error" style={{ color: "var(--accent-warn)" }}>
            {result.error} No statistics are shown rather than statistics computed from a partial or
            missing catalogue.
          </p>
        ) : (
          <>
            <section data-testid="sequence-plain" style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "12px 14px", margin: "0 0 18px", maxWidth: 820 }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, margin: "0 0 8px" }}>In plain words</h3>
              <Prose eventId={decoded} kind="sequence" template={sequenceTemplate(sequenceEvidence(result.analysis, Date.now(), event?.place ?? ""))} testId="sequence-prose" />
            </section>
            <SequenceView analysis={result.analysis} truncated={result.truncated} />
            <div style={{ maxWidth: 820, marginTop: 18 }}>
              <Ask eventId={decoded} kind="sequence" title="Ask about this sequence" placeholder="e.g. What is a b-value? Why is the Omori fit missing?" scope="the statistics on this page and a short glossary" />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
