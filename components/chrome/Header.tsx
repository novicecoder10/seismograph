import Link from "next/link";

export function Header() {
  return (
    <header
      className="grid-motif"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 12,
        padding: "14px 22px",
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-panel)",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 17,
          fontWeight: 700,
          margin: 0,
          letterSpacing: "0.02em",
        }}
      >
        SEISMOGRAPH
      </h1>
      <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
        hypocenters at true depth · forecasts only on the pages you open
      </span>
      <Link href="/scoreboard" data-testid="scoreboard-link" style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-dim)" }}>
        forecast scoreboard
      </Link>
    </header>
  );
}
