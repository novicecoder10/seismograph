"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Event } from "@/lib/events/types";
import { play, SPEEDS, type Playing } from "@/lib/seismic/audio";
import { envelope } from "@/lib/seismic/dsp";
import { fetchGsnStations, fetchNearbyShakes, fetchThreeComponent, selectRecordSection } from "@/lib/seismic/network";
import { loadTravelTimes, phaseRow, PHASES, type TravelTimeTable } from "@/lib/seismic/traveltime";
import { GlobeRenderer } from "../globe/GlobeRenderer";
import { FILTERS, PHASE_STYLE, PRE_S, SPAN_S, type FilterId } from "./phases";
import { RecordSection, type Component, type StationTrace } from "./RecordSection";

const ENV_STEP_S = 2;

type Status = { kind: "loading"; what: string } | { kind: "error"; why: string } | { kind: "ready" };

const button = { background: "var(--bg-panel-raised)", color: "var(--text-primary)", border: "1px solid var(--line)", padding: "5px 10px", fontSize: 12, cursor: "pointer" } as const;

export function WavesView({ event }: { event: Event }) {
  const depthKm = Math.max(0, event.depthKm ?? 10);
  const [table, setTable] = useState<TravelTimeTable | null>(null);
  const [traces, setTraces] = useState<StationTrace[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "loading", what: "loading travel times" });
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(300);
  const [component, setComponent] = useState<Component>("z");
  const [filter, setFilter] = useState<FilterId>("broad");
  const [selected, setSelected] = useState<number | null>(null);
  const [sound, setSound] = useState({ on: false, sweep: false, vco: false });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const globeRef = useRef<GlobeRenderer | null>(null);
  const audioRef = useRef<{ ctx: AudioContext; playing: Playing | null } | null>(null);
  const clockRef = useRef(0);
  clockRef.current = clock;

  // Data: travel times, stations, then traces, loaded progressively.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tt = await loadTravelTimes();
        if (cancelled) return;
        setTable(tt);
        setStatus({ kind: "loading", what: "finding stations" });
        const [gsn, shakes] = await Promise.all([
          fetchGsnStations(event.time).catch(() => []),
          fetchNearbyShakes(event.lat, event.lon, event.time).catch(() => []),
        ]);
        if (cancelled) return;
        const section = selectRecordSection(event, [...gsn, ...shakes]);
        if (section.length === 0) {
          setStatus({ kind: "error", why: "No broadband station or Raspberry Shake was operating for this event's time." });
          return;
        }
        setTraces(section.map((station) => ({ station, data: "loading" })));
        setStatus({ kind: "ready" });
        const start = event.time - PRE_S * 1000, end = event.time + SPAN_S * 1000;
        let next = 0;
        const worker = async () => {
          while (!cancelled && next < section.length) {
            const i = next++;
            const data = await fetchThreeComponent(section[i]!, start, end).catch(() => null);
            if (cancelled) return;
            setTraces((prev) => prev.map((t, j) => (j === i ? { ...t, data } : t)));
            setSelected((s) => (s === null && data ? i : s));
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
      } catch (e) {
        if (!cancelled) setStatus({ kind: "error", why: String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [event]);

  // Globe: one renderer for the page's life.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: GlobeRenderer;
    try {
      renderer = new GlobeRenderer({ canvas });
    } catch {
      return; // no WebGL: the record section and sound still work
    }
    globeRef.current = renderer;
    renderer.setEvents([event]);
    renderer.setTime(event.time + 1);
    renderer.setCamera({ lat: event.lat, lon: event.lon, altitude: 3.4 });
    const ro = new ResizeObserver(([e]) => e && renderer.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(canvas);
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => (drag = { x: e.clientX, y: e.clientY });
    const move = (e: PointerEvent) => { if (drag) { renderer.orbitBy(e.clientX - drag.x, e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; } };
    const up = () => (drag = null);
    const wheel = (e: WheelEvent) => { e.preventDefault(); renderer.zoomBy(e.deltaY > 0 ? 1.1 : 0.9); };
    canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    (window as unknown as { __waves?: unknown }).__waves = { stats: () => ({ ...renderer.stats }), stations: () => renderer.stationDebug() };
    return () => {
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      canvas.removeEventListener("wheel", wheel);
      renderer.dispose();
      globeRef.current = null;
    };
  }, [event]);

  useEffect(() => {
    if (!table) return;
    globeRef.current?.setWavefront({
      lat: event.lat, lon: event.lon, distStepDeg: table.distStepDeg,
      rows: PHASES.map((ph) => phaseRow(table, ph, depthKm)),
      colours: PHASES.map((ph) => PHASE_STYLE[ph]!.rgb),
    });
  }, [table, event, depthKm]);

  const stationKey = traces.map((t) => `${t.station.station}:${t.data === null ? 0 : t.data === "loading" ? 1 : 2}`).join(",");
  useEffect(() => {
    globeRef.current?.setStations(traces.map((t) => ({ lat: t.station.lat, lon: t.station.lon, hasData: t.data !== null && t.data !== "loading" })));
  }, [stationKey]);

  const envelopes = useMemo(() => traces.map((t) => {
    if (t.data === null || t.data === "loading") return null;
    return { startS: (t.data.startMs - event.time) / 1000, env: envelope(t.data.z, Math.max(1, Math.round(t.data.sampleRate * ENV_STEP_S))) };
  }), [traces, event.time]);

  // Everything is a function of the clock.
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.setWaveTime(clock);
    g.setStationBrightness(envelopes.map((e) => {
      if (!e) return 0;
      const k = Math.floor((clock - e.startS) / ENV_STEP_S);
      return k >= 0 && k < e.env.length ? e.env[k]! : 0;
    }));
  }, [clock, envelopes]);

  // Playback: the clock advances at `speed`; with sound on, the audio is the clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const a = audioRef.current?.playing;
      const next = a ? a.positionS() - PRE_S : clockRef.current + ((now - last) / 1000) * speed;
      last = now;
      if (next >= SPAN_S) { setClock(SPAN_S); setPlaying(false); return; }
      setClock(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const stopAudio = useCallback(() => {
    audioRef.current?.playing?.stop();
    if (audioRef.current) audioRef.current.playing = null;
  }, []);

  const start = () => {
    stopAudio();
    const from = clock >= SPAN_S ? 0 : clock;
    setClock(from);
    const t = selected !== null ? traces[selected] : undefined;
    const data = t && t.data !== "loading" ? t.data : null;
    if (sound.on && data) {
      audioRef.current ??= { ctx: new AudioContext(), playing: null };
      const { ctx } = audioRef.current;
      void ctx.resume();
      const samples = data[component] ?? data.z;
      const p = play(ctx, {
        samples, sourceRate: data.sampleRate, speed,
        offsetS: Math.max(0, from + (event.time - data.startMs) / 1000),
        azimuthDeg: t!.station.azimuthDeg,
        filter: sound.sweep ? { centreHz: 1000, q: 1.2, sweep: true } : null,
        vco: sound.vco,
      });
      audioRef.current.playing = p;
      void p.ended.then(() => { if (audioRef.current?.playing === p) { audioRef.current.playing = null; setPlaying(false); } });
    }
    setPlaying(true);
  };
  const pause = () => { stopAudio(); setPlaying(false); };

  useEffect(() => () => { stopAudio(); void audioRef.current?.ctx.close(); }, [stopAudio]);

  const withData = traces.filter((t) => t.data !== null && t.data !== "loading").length;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button type="button" data-testid="waves-play" style={button} onClick={playing ? pause : start}>{playing ? "Pause" : clock > 0 ? "Resume" : "Play"}</button>
        <button type="button" style={button} onClick={() => { pause(); setClock(0); }}>Restart</button>
        <label style={{ fontSize: 12, color: "var(--text-dim)" }}>
          speed{" "}
          <select value={speed} onChange={(e) => { pause(); setSpeed(Number(e.target.value)); }} style={button}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <span data-testid="waves-clock" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--text-primary)", minWidth: 150 }}>
          {Math.floor(clock / 60)} min {String(Math.floor(clock % 60)).padStart(2, "0")} s after the earthquake
        </span>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {status.kind === "loading" ? status.what : status.kind === "error" ? status.why : `${withData} of ${traces.length} stations with data`}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(460px, 100%), 1fr))", gap: 14, alignItems: "start" }}>
        <section style={{ border: "1px solid var(--line)", background: "var(--bg-void)", minWidth: 0 }}>
          <canvas ref={canvasRef} data-testid="waves-globe" style={{ width: "100%", aspectRatio: "1 / 1", display: "block", touchAction: "none" }} />
          <p style={{ fontSize: 11, color: "var(--text-dim)", margin: 0, padding: "6px 10px" }}>
            Fronts travel at iasp91 speeds from a {depthKm.toFixed(0)} km-deep source. P cannot reach 103°–142° directly
            (the core's shadow), so its front stops there and PKP picks it up beyond. Rings are stations; they fill
            with their own recorded motion as it arrives.
          </p>
        </section>

        <section style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "12px 14px", minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6, fontSize: 12, color: "var(--text-dim)" }}>
            <label>component{" "}
              <select value={component} onChange={(e) => setComponent(e.target.value as Component)} style={button}>
                <option value="z">vertical</option><option value="north">north</option><option value="east">east</option>
              </select>
            </label>
            <label>filter{" "}
              <select value={filter} onChange={(e) => setFilter(e.target.value as FilterId)} style={button}>
                {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
          </div>
          {table ? (
            <RecordSection table={table} depthKm={depthKm} originMs={event.time} traces={traces} component={component} filter={filter}
              clockS={clock} selected={selected} onScrub={(s) => { if (!playing) setClock(s); }} onSelect={setSelected} />
          ) : (
            <p style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading travel times…</p>
          )}
        </section>
      </div>

      <section data-testid="waves-sound" style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "12px 14px" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, margin: "0 0 6px" }}>Listen</h3>
        <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 8px" }}>
          The selected station (click a trace to choose), played {speed}× faster so the motion becomes audible,
          and panned by the direction from the earthquake to the station.
          {selected !== null && traces[selected] && ` Now: ${traces[selected]!.station.network}.${traces[selected]!.station.station}, ${traces[selected]!.station.distanceDeg.toFixed(1)}° away, azimuth ${traces[selected]!.station.azimuthDeg.toFixed(0)}°.`}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: "var(--text-dim)" }}>
          <label><input type="checkbox" data-testid="sound-on" checked={sound.on} onChange={(e) => { pause(); setSound({ ...sound, on: e.target.checked }); }} /> sound</label>
          <label><input type="checkbox" checked={sound.sweep} onChange={(e) => { pause(); setSound({ ...sound, sweep: e.target.checked }); }} /> filter sweep (60 Hz → 8 kHz)</label>
          <label><input type="checkbox" checked={sound.vco} onChange={(e) => { pause(); setSound({ ...sound, vco: e.target.checked }); }} /> long-period tone (motion below 0.1 Hz sets its pitch)</label>
        </div>
      </section>
    </div>
  );
}
