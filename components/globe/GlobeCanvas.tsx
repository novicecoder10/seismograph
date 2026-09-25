"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatDepth, formatMagnitude, formatUtc } from "@/lib/events/format";
import type { Event } from "@/lib/events/types";
import { subsolarPoint } from "@/lib/geo/sun";
import { EARTH_KM, welcomeCamera, type CameraState } from "@/lib/globe/camera";
import { useLayerStore } from "@/lib/store/layers";
import { useTimeStore } from "@/lib/store/time";
import type { Mechanism } from "@/lib/structure/mechanism";
import { loadSlabs } from "@/lib/structure/slab2";
import { attachControls } from "./controls";
import { IMAGERY_ATTRIBUTION } from "./earth";
import { GlobeRenderer } from "./GlobeRenderer";
import { PlaceSearch } from "./PlaceSearch";

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export interface GlobeCanvasProps {
  events: Event[];
  /** The current instant. Events after it are not drawn. */
  t: number;
  fadeSeconds: number;
  /** An event was chosen on the globe (null: the selection was closed). */
  onSelect(event: Event | null): void;
  onCameraChange?(camera: CameraState): void;
  initialCamera?: Partial<CameraState> & { lon: number; lat: number; altitude: number } | null;
}

interface Hover {
  event: Event;
  x: number;
  y: number;
}

/** A fly-to altitude that frames an event and its aftershock zone. */
const EVENT_VIEW_ALTITUDE = 1 + 900 / EARTH_KM;

export function GlobeCanvas({ events, t, fadeSeconds, onSelect, onCameraChange, initialCamera }: GlobeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GlobeRenderer | null>(null);
  const eventsRef = useRef<Event[]>(events);
  // Mirrored into refs because the renderer is constructed in a later effect
  // pass than the one that first saw these values: without this, a value that
  // never changes again is never applied at all.
  const tRef = useRef(t);
  const fadeRef = useRef(fadeSeconds);
  const pointerRef = useRef({ x: 0, y: 0 });
  const clickRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const onCameraRef = useRef(onCameraChange);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [selected, setSelected] = useState<Event | null>(null);
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);
  const [view, setView] = useState<CameraState | null>(null);

  eventsRef.current = events;
  tRef.current = t;
  fadeRef.current = fadeSeconds;
  onSelectRef.current = onSelect;
  onCameraRef.current = onCameraChange;

  const layers = useLayerStore();

  useEffect(() => {
    setSupported(webglAvailable());
  }, []);

  useEffect(() => {
    if (supported !== true) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;

    // Camera updates arrive every animation frame; React and the URL hear about
    // them at most every 150 ms.
    let pendingCam: CameraState | null = null;
    let camTimer: ReturnType<typeof setTimeout> | null = null;
    const flushCam = () => {
      camTimer = null;
      if (pendingCam === null) return;
      setView(pendingCam);
      onCameraRef.current?.(pendingCam);
    };

    const choose = (event: Event | null) => {
      setSelected(event);
      onSelectRef.current(event);
      const r = rendererRef.current;
      if (event && r) {
        const cam = r.getCamera();
        r.flyTo({ lat: event.lat, lon: event.lon, altitude: Math.min(cam.altitude, EVENT_VIEW_ALTITUDE), heading: cam.heading, tilt: cam.tilt });
      }
    };

    const renderer = new GlobeRenderer({
      canvas,
      onPick(index) {
        const event = index === null ? null : (eventsRef.current[index] ?? null);
        if (clickRef.current) {
          clickRef.current = false;
          if (event) choose(event);
          return;
        }
        setHover(event === null ? null : { event, x: pointerRef.current.x, y: pointerRef.current.y });
      },
      onCameraChange(cam) {
        pendingCam = cam;
        if (camTimer === null) camTimer = setTimeout(flushCam, 150);
      },
    });
    rendererRef.current = renderer;
    renderer.setCamera(initialCamera ?? welcomeCamera(subsolarPoint(tRef.current).lon));
    // Apply the state the renderer missed by not existing yet. uNow defaults to
    // 0, which in shader time is the year 2000, so skipping this discards the
    // entire catalogue and the globe renders empty.
    renderer.setFadeSeconds(fadeRef.current);
    renderer.setTime(tRef.current);
    renderer.setEvents(eventsRef.current);
    const L = useLayerStore.getState();
    renderer.setLabels(L.labels);
    renderer.setSunlight(L.sunlight);
    renderer.setGrid(L.grid);
    renderer.setTerrain(L.terrain);
    renderer.setXray(L.xray, false);
    setView(renderer.getCamera());

    const detach = attachControls(canvas, renderer, {
      onHover(x, y) {
        pointerRef.current = { x, y };
        setHover((prev) => (prev ? { ...prev, x, y } : prev));
        setCursor(renderer.groundAt(x, y));
        renderer.requestPick(x, y);
      },
      onClick(x, y) {
        pointerRef.current = { x, y };
        clickRef.current = true;
        renderer.requestPick(x, y);
      },
      onGesture() {
        setHover(null);
      },
      onLeave() {
        setHover(null);
        setCursor(null);
      },
    });

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      renderer.resize(r.width, r.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    if (process.env.NODE_ENV !== "production") {
      // Read by the e2e suite to assert render-on-demand and pick coalescing.
      Object.defineProperty(window, "__globeStats", {
        configurable: true,
        get: () => ({ ...renderer.stats, eventCount: eventsRef.current.length }),
      });
      // The e2e suite needs deterministic targets: probing a grid of pixels
      // finds nothing on a sparse globe.
      Object.defineProperty(window, "__globeTest", {
        configurable: true,
        get: () => ({
          focusOn: (i: number) => renderer.focusOn(i),
          screenPositionOf: (i: number) => renderer.screenPositionOf(i),
          camera: () => renderer.getCamera(),
          setCamera: (c: CameraState) => renderer.setCamera(c),
          groundAt: (x: number, y: number) => renderer.groundAt(x, y),
          elevationAt: (lat: number, lon: number) => renderer.elevationAt(lat, lon),
          pose: () => renderer.debugPose(),
          project: (lat: number, lon: number) => renderer.debugProject(lat, lon),
        }),
      });
    }

    return () => {
      if (camTimer !== null) clearTimeout(camTimer);
      detach();
      observer.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
    // initialCamera is a mount-time seed; later camera changes come through
    // imperative calls, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  useEffect(() => {
    rendererRef.current?.setEvents(events);
  }, [events]);

  useEffect(() => {
    rendererRef.current?.setTime(t);
  }, [t]);

  useEffect(() => {
    rendererRef.current?.setFadeSeconds(fadeSeconds);
  }, [fadeSeconds]);

  useEffect(() => rendererRef.current?.setLabels(layers.labels), [layers.labels, supported]);
  useEffect(() => rendererRef.current?.setSunlight(layers.sunlight), [layers.sunlight, supported]);
  useEffect(() => rendererRef.current?.setGrid(layers.grid), [layers.grid, supported]);
  useEffect(() => rendererRef.current?.setTerrain(layers.terrain), [layers.terrain, supported]);
  useEffect(() => rendererRef.current?.setXray(layers.xray), [layers.xray, supported]);

  const mechanismsOn = layers.mechanisms;
  const rangeKey = useTimeStore((s) => `${Math.floor(s.range.startMs / 3_600_000)}:${Math.floor(s.range.endMs / 3_600_000)}`);
  useEffect(() => {
    if (!mechanismsOn) {
      rendererRef.current?.setMechanisms(null);
      return;
    }
    const { startMs, endMs } = useTimeStore.getState().range;
    const ctrl = new AbortController();
    fetch(`/api/mechanisms?from=${Math.floor(startMs)}&to=${Math.ceil(endMs)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j: { mechanisms?: Mechanism[] }) => rendererRef.current?.setMechanisms(j.mechanisms ?? []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [mechanismsOn, rangeKey, supported]);

  const slabsOn = layers.slabs;
  useEffect(() => {
    if (!slabsOn) {
      rendererRef.current?.setSlabs(null);
      return;
    }
    let cancelled = false;
    // The slab layer is a reading aid: failing to load it must not cost the globe.
    loadSlabs().then((slabs) => { if (!cancelled) rendererRef.current?.setSlabs(slabs); }).catch(() => {});
    return () => { cancelled = true; };
  }, [slabsOn, supported]);

  if (supported === false) {
    return (
      <div
        data-testid="webgl-fallback"
        style={{
          padding: 22,
          margin: 22,
          color: "var(--text-dim)",
          border: "1px solid var(--line)",
          background: "var(--bg-panel)",
        }}
      >
        <strong style={{ color: "var(--accent-warn)" }}>WebGL unavailable.</strong> The 3D
        globe needs WebGL, which this browser does not provide. Switch to the table view —
        every event and every filter works there.
      </div>
    );
  }

  const r = rendererRef.current;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#000" }}>
      <canvas ref={canvasRef} data-testid="globe-canvas" aria-label="Interactive globe of earthquakes" style={{ width: "100%", height: "100%", display: "block", outline: "none" }} />

      <PlaceSearch onFly={(lat, lon, altitude) => r?.flyTo({ lat, lon, altitude })} />

      <div style={{ position: "absolute", right: 14, top: 14, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        <Compass heading={view?.heading ?? 0} tilt={view?.tilt ?? 0} onReset={() => r?.resetOrientation()} />
        <GlassButton label="Zoom in" testId="zoom-in" onClick={() => { const c = canvasRef.current?.getBoundingClientRect(); r?.zoomBy(0.5, (c?.width ?? 0) / 2, (c?.height ?? 0) / 2); }}>+</GlassButton>
        <GlassButton label="Zoom out" testId="zoom-out" onClick={() => { const c = canvasRef.current?.getBoundingClientRect(); r?.zoomBy(2, (c?.width ?? 0) / 2, (c?.height ?? 0) / 2); }}>−</GlassButton>
        <GlassButton label="Whole Earth" testId="zoom-home" onClick={() => { const c = r?.getCamera(); if (c) r?.flyTo({ lat: c.lat, lon: c.lon, altitude: 3.2 }); }}>◯</GlassButton>
      </div>

      {hover !== null && selected?.id !== hover.event.id && <HoverTooltip {...hover} />}
      {selected !== null && <SelectionCard event={selected} onClose={() => { setSelected(null); onSelectRef.current(null); }} />}

      <div
        data-testid="globe-hud"
        style={{ position: "absolute", left: 12, bottom: 10, fontSize: 11, color: "rgba(231,235,238,0.85)", textShadow: "0 1px 2px #000", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}
      >
        {cursor && <span>{fmtLat(cursor.lat)} {fmtLon(cursor.lon)} · </span>}
        {view && <span data-testid="hud-altitude">eye {fmtAltitude(view.altitude)}</span>}
        {layers.xray && <span style={{ color: "#9cc4ff" }}> · x-ray: true depth</span>}
      </div>
      <Attribution />
    </div>
  );
}

/** The full credit line on wide screens; a tap-to-read "©" on phones, where the
 *  full line would cover a third of the planet. */
function Attribution() {
  const [open, setOpen] = useState(false);
  const text: React.CSSProperties = { fontSize: 9.5, lineHeight: 1.35, color: "rgba(231,235,238,0.62)", textShadow: "0 1px 2px #000" };
  return (
    <div style={{ position: "absolute", right: 10, bottom: 8, maxWidth: "min(620px, calc(100% - 20px))", textAlign: "right" }}>
      <span className="only-wide" style={text} data-testid="imagery-attribution">{IMAGERY_ATTRIBUTION}</span>
      <span className="only-narrow">
        {open ? (
          <button type="button" onClick={() => setOpen(false)} style={{ ...text, ...glass, background: "rgba(12,16,20,0.85)", padding: "6px 8px", textAlign: "left", cursor: "pointer" }}>
            {IMAGERY_ATTRIBUTION}
          </button>
        ) : (
          <button type="button" onClick={() => setOpen(true)} aria-label="Imagery credits" style={{ ...text, background: "none", border: "none", cursor: "pointer", fontSize: 11 }}>
            © imagery
          </button>
        )}
      </span>
    </div>
  );
}

const fmtLat = (v: number) => `${Math.abs(v).toFixed(3)}°${v >= 0 ? "N" : "S"}`;
const fmtLon = (v: number) => `${Math.abs(v).toFixed(3)}°${v >= 0 ? "E" : "W"}`;
function fmtAltitude(altitude: number): string {
  const km = (altitude - 1) * EARTH_KM;
  return km >= 100 ? `${Math.round(km).toLocaleString()} km` : km >= 10 ? `${km.toFixed(0)} km` : `${km.toFixed(1)} km`;
}

const glass: React.CSSProperties = {
  background: "rgba(12,16,20,0.72)",
  backdropFilter: "blur(6px)",
  border: "1px solid rgba(255,255,255,0.14)",
  color: "#e7ebee",
};

function GlassButton({ label, testId, onClick, children }: { label: string; testId: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} data-testid={testId} onClick={onClick} style={{ ...glass, width: 34, height: 34, borderRadius: 17, fontSize: 17, lineHeight: 1, cursor: "pointer", padding: 0 }}>
      {children}
    </button>
  );
}

function Compass({ heading, tilt, onReset }: { heading: number; tilt: number; onReset(): void }) {
  const off = heading > 0.5 && heading < 359.5 || tilt > 0.5;
  return (
    <button
      type="button"
      aria-label="Reset to north up, looking straight down"
      title="North up (N)"
      data-testid="compass"
      onClick={onReset}
      style={{ ...glass, width: 46, height: 46, borderRadius: 23, padding: 0, cursor: "pointer", opacity: off ? 1 : 0.75 }}
    >
      <svg viewBox="-23 -23 46 46" width={46} height={46} style={{ display: "block", transform: `rotate(${-heading}deg)` }}>
        <polygon points="0,-15 4.5,0 -4.5,0" fill="#ff5c47" />
        <polygon points="0,15 4.5,0 -4.5,0" fill="#c9d1d8" />
        <text x={0} y={-16.5} textAnchor="middle" fontSize={7} fill="#e7ebee" fontWeight={700}>N</text>
      </svg>
    </button>
  );
}

function HoverTooltip({ event, x, y }: Hover) {
  return (
    <div
      data-testid="hover-tooltip"
      style={{
        position: "absolute",
        left: Math.min(x + 14, 9999),
        top: y + 14,
        pointerEvents: "none",
        ...glass,
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.5,
        maxWidth: 280,
      }}
    >
      <div style={{ fontWeight: 500 }}>{formatMagnitude(event.magnitude, event.magType)}</div>
      <div style={{ color: "#b8c1c8" }}>{formatDepth(event.depthKm)}</div>
      <div style={{ color: "#b8c1c8" }}>{event.place}</div>
      <div style={{ color: "#8d979f" }}>{formatUtc(event.time)}</div>
      <div style={{ color: "#8d979f" }}>
        {event.source.toUpperCase()} · {event.status} · click to fly there
      </div>
    </div>
  );
}

function SelectionCard({ event, onClose }: { event: Event; onClose(): void }) {
  const id = encodeURIComponent(event.id);
  const link: React.CSSProperties = { color: "#e7ebee", textDecoration: "underline", textUnderlineOffset: 3 };
  return (
    <div
      data-testid="selection-card"
      role="dialog"
      aria-label={`Earthquake: ${event.place}`}
      style={{ position: "absolute", left: 14, top: 64, width: "min(320px, calc(100% - 28px))", ...glass, padding: "12px 14px", fontSize: 12, lineHeight: 1.55 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong style={{ fontSize: 18, fontWeight: 600 }}>{formatMagnitude(event.magnitude, event.magType)}</strong>
        <button type="button" onClick={onClose} aria-label="Close" data-testid="selection-close" style={{ marginLeft: "auto", background: "none", border: "none", color: "#b8c1c8", fontSize: 16, cursor: "pointer" }}>
          ×
        </button>
      </div>
      <div>{event.place}</div>
      <div style={{ color: "#b8c1c8" }}>{formatUtc(event.time)} · {formatDepth(event.depthKm)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", marginTop: 10 }}>
        <Link href={`/event/${id}`} style={link} data-testid="selection-event-link">event page</Link>
        <Link href={`/sequence/${id}`} style={link}>aftershock sequence</Link>
        <Link href={`/forecast/${id}`} style={link}>forecast</Link>
        <Link href={`/waves/${id}`} style={link}>seismic waves</Link>
        <Link href={`/section/${id}`} style={link}>cross-section</Link>
        <Link href={`/compare/${id}`} style={link}>past sequences</Link>
      </div>
    </div>
  );
}
