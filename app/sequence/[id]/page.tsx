import Link from "next/link";
import { SequenceView } from "@/components/sequence/SequenceView";
import { loadSequence } from "@/lib/repositories/sequence";

/** Declustering is O(n²) on up to 3000 events: run it once per sequence per ten
 *  minutes, not once per visitor. */
export const revalidate = 600;

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const result = await loadSequence(decoded);

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
          <SequenceView analysis={result.analysis} truncated={result.truncated} />
        )}
      </div>
    </main>
  );
}
