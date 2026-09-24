import Link from "next/link";
import { WavesViewLazy } from "@/components/waves/WavesViewLazy";
import { formatMagnitude, formatUtc } from "@/lib/events/format";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";

const repo = createUsgsFdsnRepository();

export default async function WavesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const event = await repo.byId(decoded).catch(() => null);
  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "22px 22px 60px" }}>
      <Link href={`/event/${encodeURIComponent(decoded)}`} style={{ color: "var(--text-dim)", fontSize: 12 }}>← back to the event</Link>
      {event === null ? (
        <p style={{ color: "var(--text-dim)", marginTop: 18 }}>
          No event with the identifier <code>{decoded}</code> could be retrieved.
        </p>
      ) : (
        <>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "18px 0 4px" }}>
            Seismic waves from the {formatMagnitude(event.magnitude, event.magType)}
          </h2>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 14px" }}>{event.place} · {formatUtc(event.time)}</p>
          <WavesViewLazy event={event} />
        </>
      )}
    </main>
  );
}
