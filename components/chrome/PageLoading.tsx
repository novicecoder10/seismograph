/**
 * Shown the instant a link is followed, while the server fetches and analyses
 * the catalogue (one to five seconds). Without it a click looks like it did
 * nothing, which reads as a broken link.
 */
export function PageLoading({ title, detail }: { title: string; detail: string }) {
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 22px 60px" }} aria-busy="true" data-testid="page-loading">
      <div style={{ color: "var(--text-dim)", fontSize: 12 }}>← back</div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "18px 0 6px" }}>{title}</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 13, margin: 0 }}>
        <span className="loading-pulse" aria-hidden="true" /> {detail}
      </p>
      <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
        {[120, 260, 180].map((h, i) => (
          <div key={i} className="loading-block" style={{ height: h }} />
        ))}
      </div>
    </main>
  );
}
