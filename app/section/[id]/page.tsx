import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { CrossSection, type SectionPoint } from "@/components/structure/CrossSection";
import { formatMagnitude, formatUtc } from "@/lib/events/format";
import { bboxAround } from "@/lib/geo/bbox";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";
import { profileFor, projectOnto, slabAlong } from "@/lib/structure/section";
import { parseSlab2, SLAB_NAMES } from "@/lib/structure/slab2";

export const revalidate = 86400;

const repo = createUsgsFdsnRepository();
const MIN_MAG = 4.5;
const SINCE = Date.UTC(1976, 0, 1);

function slabs() {
  const b = readFileSync(path.join(process.cwd(), "public/data/slab2.bin"));
  return parseSlab2(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export default async function SectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const event = await repo.byId(decoded).catch(() => null);

  let body: React.ReactNode;
  if (!event) {
    body = <p style={{ color: "var(--text-dim)" }}>No event with the identifier <code>{decoded}</code> could be retrieved.</p>;
  } else {
    const s = slabs();
    const profile = profileFor(event.lat, event.lon, s);
    let points: SectionPoint[] = [];
    let error: string | null = null;
    let truncated = false;
    try {
      const page = await repo.query(
        {
          range: { startMs: SINCE, endMs: Date.now() },
          minMagnitude: MIN_MAG, maxMagnitude: null, minDepthKm: null, maxDepthKm: null,
          bbox: bboxAround(event.lat, event.lon, profile.halfLengthKm + profile.halfWidthKm),
        },
        { limit: 20_000 },
      );
      truncated = page.cursor !== null;
      points = [event, ...page.events.filter((e) => e.id !== event.id)].flatMap((e) => {
        if (e.depthKm === null) return [];
        const q = projectOnto(profile, e.lat, e.lon);
        if (Math.abs(q.acrossKm) > profile.halfWidthKm || Math.abs(q.alongKm) > profile.halfLengthKm) return [];
        return [{ id: e.id, alongKm: q.alongKm, depthKm: e.depthKm, magnitude: e.magnitude, time: e.time, place: e.place }];
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const slabName = profile.slab ? SLAB_NAMES[profile.slab] ?? profile.slab : null;
    body = (
      <>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "0 0 4px" }}>
          Depth cross-section through the {formatMagnitude(event.magnitude, event.magType)}
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 14px", maxWidth: 820 }}>
          {event.place} · {formatUtc(event.time)} · Earthquakes of M {MIN_MAG}+ since 1976 within {profile.halfWidthKm} km of a{" "}
          {profile.halfLengthKm * 2} km line through this event,{" "}
          {profile.orientation === "down-dip"
            ? `oriented down the dip of the ${slabName} slab (toward ${profile.azimuthDeg.toFixed(0)}°), so the slab is cut at right angles to its trench.`
            : "oriented east–west, since no subducting slab lies within 150 km."}
          {truncated && " The catalogue query reached its row limit; older events are missing."}
        </p>
        {error ? (
          <p style={{ color: "var(--accent-warn)" }}>The catalogue could not be fetched ({error}).</p>
        ) : (
          <section style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "12px 14px" }}>
            <CrossSection points={points} mainId={event.id} halfLengthKm={profile.halfLengthKm} slab={slabAlong(profile, s)} slabName={slabName} azimuthDeg={profile.azimuthDeg} />
            <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "6px 0 0" }}>
              {points.length.toLocaleString()} earthquakes. Depths are catalogue depths; many shallow events are fixed at
              10 or 35 km by the locating agency, which shows as horizontal lines of points.
            </p>
          </section>
        )}
      </>
    );
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "22px 22px 60px" }}>
      <Link href={`/event/${encodeURIComponent(decoded)}`} style={{ color: "var(--text-dim)", fontSize: 12 }}>← back to the event</Link>
      <div style={{ marginTop: 18 }}>{body}</div>
    </main>
  );
}
