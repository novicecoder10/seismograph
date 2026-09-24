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
        hypocenters at true depth · no forecast in this build
      </span>
    </header>
  );
}
