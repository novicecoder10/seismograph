export interface LegendItem {
  label: string;
  color: string;
  kind: "dot" | "line" | "band";
}

/** Present whenever a chart shows two or more series, so identity never rests
 *  on colour alone. The key mirrors the mark; the text stays in text tokens. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11, color: "var(--text-dim)", margin: "4px 0 2px" }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i.kind === "dot" && <span style={{ width: 8, height: 8, borderRadius: 4, background: i.color }} />}
          {i.kind === "line" && <span style={{ width: 14, height: 2, background: i.color }} />}
          {i.kind === "band" && <span style={{ width: 14, height: 8, background: i.color, opacity: 0.25 }} />}
          {i.label}
        </span>
      ))}
    </div>
  );
}
