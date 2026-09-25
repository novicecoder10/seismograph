"use client";

import { downloadBlob, fileStem, svgDocument, svgToPng } from "@/lib/export/download";

/** "SVG · PNG" under a chart: the figure as drawn, for a paper or a slide. */
export function ChartDownload({ svgRef, name }: { svgRef: React.RefObject<SVGSVGElement | null>; name: string }) {
  const save = async (kind: "svg" | "png") => {
    const svg = svgRef.current;
    if (svg === null) return;
    const doc = svgDocument(svg);
    const stem = `seismograph-${fileStem(name)}`;
    if (kind === "svg") return downloadBlob(doc, `${stem}.svg`, "image/svg+xml");
    const [, , w, h] = (svg.getAttribute("viewBox") ?? "0 0 640 300").split(/\s+/).map(Number);
    downloadBlob(await svgToPng(doc, w ?? 640, h ?? 300), `${stem}.png`, "image/png");
  };
  const btn: React.CSSProperties = { background: "none", border: "none", padding: 0, color: "var(--text-dim)", font: "inherit", cursor: "pointer", textDecoration: "underline dotted" };
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>
      download
      <button type="button" style={btn} data-testid={`${name}-download-svg`} onClick={() => void save("svg")}>SVG</button>
      <button type="button" style={btn} data-testid={`${name}-download-png`} onClick={() => void save("png")}>PNG</button>
    </div>
  );
}
