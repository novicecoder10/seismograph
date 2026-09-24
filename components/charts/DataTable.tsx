/** The table-view twin every chart carries: the WCAG-clean equivalent, and the
 *  route to every value that does not depend on hovering. */
export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <details style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
      <summary style={{ cursor: "pointer" }}>table view ({rows.length} rows)</summary>
      <div style={{ maxHeight: 220, overflow: "auto", marginTop: 6 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <caption style={{ textAlign: "left", paddingBottom: 4 }}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} style={{ textAlign: "left", padding: "3px 8px", borderBottom: "1px solid var(--line)", fontWeight: 500 }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} style={{ padding: "2px 8px", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
