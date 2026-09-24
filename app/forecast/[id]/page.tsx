import Link from "next/link";
import { ForecastView } from "@/components/forecast/ForecastView";
import { loadForecast } from "@/lib/repositories/forecast";

/** A forecast is recomputed at most every ten minutes per event. */
export const revalidate = 600;

export default async function ForecastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const result = await loadForecast(decoded);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "22px 22px 60px" }}>
      <Link href={`/event/${encodeURIComponent(decoded)}`} style={{ color: "var(--text-dim)", fontSize: 12 }}>
        ← back to the event
      </Link>
      <div style={{ marginTop: 18 }}>
        {"error" in result ? (
          <p data-testid="forecast-error" style={{ color: "var(--accent-warn)" }}>{result.error}</p>
        ) : (
          <ForecastView result={result} />
        )}
      </div>
    </main>
  );
}
