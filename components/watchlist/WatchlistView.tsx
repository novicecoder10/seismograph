"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatUtc } from "@/lib/events/format";
import type { Event } from "@/lib/events/types";
import { bboxAround } from "@/lib/geo/bbox";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";
import {
  addPlace, digest, digestWindow, EMPTY, MAX_PLACES, parseState, removePlace, STORAGE_KEY, usualSentence, validatePlace,
  type Digest, type Place, type WatchState,
} from "@/lib/watchlist/watchlist";

const repo = createUsgsFdsnRepository();

function load(): WatchState {
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY;
  }
}

function save(s: WatchState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

async function fetchDigest(p: Place, lastVisit: number | null, now: number): Promise<Digest> {
  const w = digestWindow(lastVisit, now);
  const page = await repo.query(
    { range: { startMs: w.referenceStartMs, endMs: now }, minMagnitude: p.minMagnitude, maxMagnitude: null, minDepthKm: null, maxDepthKm: null, bbox: bboxAround(p.lat, p.lon, p.radiusKm) },
    { limit: 20_000 },
  );
  return digest(p, page.events, lastVisit, now);
}

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; d: Digest };

const input: React.CSSProperties = { background: "var(--bg-panel)", border: "1px solid var(--line)", color: "var(--text-primary)", font: "inherit", padding: "4px 6px", width: "100%" };
const button: React.CSSProperties = { background: "none", border: "1px solid var(--line)", color: "var(--text-primary)", font: "inherit", padding: "4px 10px", cursor: "pointer" };

export function WatchlistView() {
  const [s, setS] = useState<WatchState | null>(null);
  const [persisted, setPersisted] = useState(true);
  const [now] = useState(() => Date.now());
  const [digests, setDigests] = useState<Record<string, Loaded>>({});
  const [form, setForm] = useState({ name: "", lat: "", lon: "", radiusKm: "300", minMagnitude: "4.5" });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setS(load());
    // A link from an event page pre-fills the form: /watchlist?lat=…&lon=…&name=…
    const q = new URLSearchParams(window.location.search);
    if (q.has("lat") && q.has("lon")) setForm((f) => ({ ...f, lat: q.get("lat")!, lon: q.get("lon")!, name: q.get("name") ?? "" }));
  }, []);

  const update = useCallback((next: WatchState) => {
    setS(next);
    setPersisted(save(next));
  }, []);

  useEffect(() => {
    if (s === null) return;
    for (const p of s.places) {
      if (digests[p.id] !== undefined) continue;
      setDigests((d) => ({ ...d, [p.id]: { state: "loading" } }));
      fetchDigest(p, s.lastVisit, now).then(
        (d) => setDigests((m) => ({ ...m, [p.id]: { state: "ok", d } })),
        (e: unknown) => setDigests((m) => ({ ...m, [p.id]: { state: "error", message: e instanceof Error ? e.message : String(e) } })),
      );
    }
  }, [s, digests, now]);

  if (s === null) return <p style={{ color: "var(--text-dim)" }}>Loading your watchlist…</p>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = { name: form.name, lat: Number(form.lat), lon: Number(form.lon), radiusKm: Number(form.radiusKm), minMagnitude: Number(form.minMagnitude) };
    const err = form.lat === "" || form.lon === "" ? "Give a latitude and longitude." : validatePlace(p);
    setFormError(err);
    if (err !== null) return;
    update(addPlace(s, p, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`));
    setForm({ name: "", lat: "", lon: "", radiusKm: form.radiusKm, minMagnitude: form.minMagnitude });
  };

  const markSeen = () => {
    update({ ...s, lastVisit: Date.now() });
    setDigests({});
  };

  const since = digestWindow(s.lastVisit, now).sinceMs;

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "0 0 4px" }}>Watchlist</h1>
      <p style={{ color: "var(--text-dim)", marginTop: 0, fontSize: 13 }} data-testid="watchlist-intro">
        Places you care about, kept in this browser only: no account, nothing sent anywhere, no notifications. This page
        is a digest you read when you choose to, not an alert. It shows what the catalogue recorded and sets it against
        what each place usually records.
      </p>
      {!persisted && (
        <p style={{ color: "var(--accent-warn)", fontSize: 12 }} data-testid="watchlist-not-saved">
          This browser is not letting the page save, so the list will be gone when you leave.
        </p>
      )}

      {s.places.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12, margin: "18px 0 10px", fontSize: 13 }}>
          <span data-testid="watchlist-since">
            {s.lastVisit === null ? `First visit: showing the past 7 days, since ${formatUtc(since)}.` : `Since you last marked this read, ${formatUtc(since)}.`}
          </span>
          <button type="button" style={button} onClick={markSeen} data-testid="watchlist-mark-seen">Mark as read</button>
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {s.places.map((p) => (
          <PlaceCard key={p.id} p={p} loaded={digests[p.id]} onRemove={() => { update(removePlace(s, p.id)); }} />
        ))}
      </div>

      <form onSubmit={submit} data-testid="watchlist-form" style={{ marginTop: 26, padding: 14, border: "1px solid var(--line)", background: "var(--bg-panel)" }}>
        <div style={{ fontSize: 13, marginBottom: 10 }}>Add a place {s.places.length >= MAX_PLACES && <span style={{ color: "var(--accent-warn)" }}>(the list is full at {MAX_PLACES})</span>}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(130px, 100%), 1fr))", gap: 10, fontSize: 12 }}>
          {([
            ["name", "name", "text"],
            ["lat", "latitude", "number"],
            ["lon", "longitude", "number"],
            ["radiusKm", "radius (km)", "number"],
            ["minMagnitude", "from magnitude", "number"],
          ] as const).map(([k, label, type]) => (
            <label key={k} style={{ color: "var(--text-dim)" }}>
              {label}
              <input
                type={type}
                step="any"
                value={form[k]}
                data-testid={`watchlist-${k}`}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                style={input}
              />
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
          <button type="submit" style={button} data-testid="watchlist-add" disabled={s.places.length >= MAX_PLACES}>Add</button>
          {formError && <span role="alert" style={{ color: "var(--accent-warn)", fontSize: 12 }} data-testid="watchlist-form-error">{formError}</span>}
        </div>
      </form>
    </div>
  );
}

function PlaceCard({ p, loaded, onRemove }: { p: Place; loaded: Loaded | undefined; onRemove: () => void }) {
  return (
    <section data-testid="watchlist-place" style={{ border: "1px solid var(--line)", padding: 14, background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>{p.name}</h2>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
          M{p.minMagnitude.toFixed(1)}+ within {p.radiusKm} km of {p.lat.toFixed(2)}°, {p.lon.toFixed(2)}°
        </span>
        <button type="button" onClick={onRemove} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-dim)", font: "inherit", fontSize: 11, cursor: "pointer", textDecoration: "underline dotted" }} data-testid="watchlist-remove">
          remove
        </button>
      </div>
      {loaded === undefined || loaded.state === "loading" ? (
        <p style={{ color: "var(--text-dim)", fontSize: 12 }}>Reading the catalogue…</p>
      ) : loaded.state === "error" ? (
        <p style={{ color: "var(--accent-warn)", fontSize: 12 }}>The catalogue could not be reached ({loaded.message}). Nothing is shown rather than a partial count.</p>
      ) : (
        <Summary d={loaded.d} />
      )}
    </section>
  );
}

function Summary({ d }: { d: Digest }) {
  const n = d.since.length;
  return (
    <div style={{ fontSize: 13, marginTop: 8 }} data-testid="watchlist-digest" data-usual={d.usual}>
      <p style={{ margin: "0 0 6px" }}>
        <strong style={{ fontSize: 20, fontWeight: 500, fontVariantNumeric: "tabular-nums" }} data-testid="watchlist-count">{n}</strong>{" "}
        {n === 1 ? "earthquake" : "earthquakes"}
        {d.largest && <> · largest M{d.largest.magnitude.toFixed(1)}</>}
        <span style={{ color: "var(--text-dim)" }}>
          {" "}· this area usually records about {d.typicalPer30Days < 10 ? d.typicalPer30Days.toFixed(1) : Math.round(d.typicalPer30Days)} per 30 days
          {d.usual !== "no-reference" && <>; for this period, {d.range95[0]}–{d.range95[1]} would be typical</>}
        </span>
      </p>
      <p style={{ margin: "0 0 8px", color: "var(--text-dim)" }}>{usualSentence(d)}</p>
      {n > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
          {d.since.slice(0, 8).map((e: Event) => (
            <li key={e.id}>
              <Link href={`/event/${encodeURIComponent(e.id)}`} style={{ color: "var(--text-primary)" }}>M{e.magnitude.toFixed(1)} {e.place}</Link>{" "}
              <span style={{ color: "var(--text-faint)" }}>{formatUtc(e.time)}</span>
            </li>
          ))}
          {n > 8 && <li style={{ color: "var(--text-dim)" }}>and {n - 8} more</li>}
        </ul>
      )}
    </div>
  );
}
