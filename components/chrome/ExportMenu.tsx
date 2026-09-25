"use client";

import { useState } from "react";
import type { Event, EventFilter } from "@/lib/events/types";
import { downloadBlob } from "@/lib/export/download";

type Format = "csv" | "tsv" | "json" | "geojson" | "quakeml" | "kml" | "kmz" | "xlsx" | "parquet";

const FORMATS: { id: Format; label: string; ext: string; type: string }[] = [
  { id: "csv", label: "CSV", ext: "csv", type: "text/csv" },
  { id: "tsv", label: "TSV", ext: "tsv", type: "text/tab-separated-values" },
  { id: "json", label: "JSON", ext: "json", type: "application/json" },
  { id: "geojson", label: "GeoJSON", ext: "geojson", type: "application/geo+json" },
  { id: "quakeml", label: "QuakeML 1.2", ext: "xml", type: "application/xml" },
  { id: "kml", label: "KML", ext: "kml", type: "application/vnd.google-earth.kml+xml" },
  { id: "kmz", label: "KMZ", ext: "kmz", type: "application/vnd.google-earth.kmz" },
  { id: "xlsx", label: "Excel (XLSX)", ext: "xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { id: "parquet", label: "Parquet", ext: "parquet", type: "application/vnd.apache.parquet" },
];

/**
 * Export exactly what is on screen: the events currently loaded under the
 * current filter, built in the browser. The format code (Parquet writer and
 * all) loads only when someone asks for a file.
 */
export function ExportMenu({ events, filter }: { events: Event[]; filter: EventFilter }) {
  const [open, setOpen] = useState(false);
  const [snippet, setSnippet] = useState<string | null>(null);

  const save = async (f: (typeof FORMATS)[number]) => {
    const m = await import("@/lib/export/formats");
    const data: BlobPart =
      f.id === "csv" ? m.toCsv(events)
      : f.id === "tsv" ? m.toTsv(events)
      : f.id === "json" ? m.toJson(events, filter)
      : f.id === "geojson" ? m.toGeoJson(events)
      : f.id === "quakeml" ? m.toQuakeMl(events)
      : f.id === "kml" ? m.toKml(events)
      : f.id === "kmz" ? (m.toKmz(events) as Uint8Array<ArrayBuffer>)
      : f.id === "xlsx" ? (m.toXlsx(events) as Uint8Array<ArrayBuffer>)
      : m.toParquet(events);
    const day = new Date().toISOString().slice(0, 10);
    downloadBlob(data, `seismograph-${day}-${events.length}-events.${f.ext}`, f.type);
  };

  const showSnippet = async () => {
    const m = await import("@/lib/export/formats");
    setSnippet(m.obspySnippet(filter));
  };

  const item: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "var(--text-primary)", font: "inherit", padding: "4px 10px", cursor: "pointer" };

  return (
    <span style={{ position: "relative" }}>
      <button
        type="button"
        data-testid="export-button"
        aria-expanded={open}
        disabled={events.length === 0}
        onClick={() => setOpen((o) => !o)}
        style={{ background: "none", border: "1px solid var(--line)", color: "var(--text-dim)", font: "inherit", padding: "1px 8px", cursor: "pointer" }}
      >
        export {events.length.toLocaleString()} ▾
      </button>
      {open && (
        <div
          data-testid="export-menu"
          role="menu"
          style={{ position: "absolute", top: "100%", left: 0, zIndex: 20, marginTop: 4, minWidth: 190, background: "var(--bg-panel-raised)", border: "1px solid var(--line)", padding: "4px 0", fontSize: 12 }}
        >
          {FORMATS.map((f) => (
            <button key={f.id} type="button" role="menuitem" style={item} data-testid={`export-${f.id}`} onClick={() => { void save(f); setOpen(false); }}>
              {f.label}
            </button>
          ))}
          <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0" }} />
          <button type="button" role="menuitem" style={item} data-testid="export-obspy" onClick={() => { void showSnippet(); setOpen(false); }}>
            Python (ObsPy) query…
          </button>
        </div>
      )}
      {snippet !== null && (
        <div
          role="dialog"
          aria-label="ObsPy snippet"
          data-testid="obspy-snippet"
          style={{ position: "fixed", inset: "10% 50% auto auto", transform: "translateX(50%)", width: "min(640px, calc(100vw - 32px))", zIndex: 30, background: "var(--bg-panel-raised)", border: "1px solid var(--line)", padding: 14 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, color: "var(--text-dim)" }}>
            The same query, reproducible with ObsPy
            <span style={{ display: "flex", gap: 10 }}>
              <button type="button" style={{ ...item, width: "auto", padding: 0, color: "var(--text-dim)" }} onClick={() => void navigator.clipboard?.writeText(snippet)}>copy</button>
              <button type="button" style={{ ...item, width: "auto", padding: 0, color: "var(--text-dim)" }} onClick={() => setSnippet(null)}>close</button>
            </span>
          </div>
          <pre style={{ margin: 0, fontSize: 11, overflowX: "auto", color: "var(--text-primary)" }}>{snippet}</pre>
        </div>
      )}
    </span>
  );
}
