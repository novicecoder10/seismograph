"use client";

import { useState } from "react";
import { EARTH_KM } from "@/lib/globe/camera";
import { parseCoordinates, parseNominatim, type PlaceResult } from "@/lib/globe/search";

/**
 * Fly to a place. Nominatim (OpenStreetMap) is asked only on submit, never per
 * keystroke: its usage policy allows at most one request a second, and this is
 * a hobby project using a free public service. Coordinates never leave the page.
 */
export function PlaceSearch({ onFly }: { onFly(lat: number, lon: number, altitude: number): void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const coords = parseCoordinates(q);
    if (coords) {
      setResults(null);
      onFly(coords.lat, coords.lon, 1 + 60 / EARTH_KM);
      return;
    }
    if (q.trim().length < 2) return;
    setStatus("searching…");
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q.trim())}`, { headers: { Accept: "application/json" } });
      const list = parseNominatim(await res.json());
      setStatus(list.length === 0 ? "no place by that name" : null);
      if (list.length === 1) {
        onFly(list[0]!.lat, list[0]!.lon, list[0]!.altitude);
        setResults(null);
      } else setResults(list);
    } catch {
      setStatus("search unavailable; coordinates still work (e.g. 35.68, 139.69)");
    }
  };

  const glass: React.CSSProperties = { background: "rgba(12,16,20,0.72)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,0.14)", color: "#e7ebee" };
  return (
    <div style={{ position: "absolute", left: 14, top: 14, width: "min(320px, calc(100% - 90px))", zIndex: 2 }}>
      <form onSubmit={submit} role="search">
        <input
          data-testid="place-search"
          aria-label="Fly to a place or coordinates"
          placeholder="Fly to a place, or lat, lon"
          value={q}
          onChange={(e) => { setQ(e.target.value); setStatus(null); }}
          style={{ ...glass, width: "100%", boxSizing: "border-box", borderRadius: 18, padding: "8px 14px", font: "inherit", fontSize: 13, outline: "none" }}
        />
      </form>
      {status && <div style={{ ...glass, marginTop: 4, padding: "5px 12px", fontSize: 11, borderRadius: 10 }}>{status}</div>}
      {results && results.length > 0 && (
        <ul data-testid="place-results" style={{ ...glass, listStyle: "none", margin: "4px 0 0", padding: 4, borderRadius: 10, fontSize: 12 }}>
          {results.map((r) => (
            <li key={`${r.lat},${r.lon},${r.name}`}>
              <button
                type="button"
                onClick={() => { onFly(r.lat, r.lon, r.altitude); setResults(null); }}
                style={{ background: "none", border: "none", color: "inherit", font: "inherit", textAlign: "left", width: "100%", padding: "5px 8px", cursor: "pointer" }}
              >
                {r.name}
              </button>
            </li>
          ))}
          <li style={{ padding: "3px 8px", fontSize: 10, color: "#8d979f" }}>Search © OpenStreetMap contributors (Nominatim)</li>
        </ul>
      )}
    </div>
  );
}
