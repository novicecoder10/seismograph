"use client";

import { useEffect, useRef, useState } from "react";
import { formatDepth, formatMagnitude, formatUtc } from "@/lib/events/format";
import type { Event } from "@/lib/events/types";
import { useLayerStore } from "@/lib/store/layers";
import { useTimeStore } from "@/lib/store/time";
import type { Mechanism } from "@/lib/structure/mechanism";
import { loadSlabs } from "@/lib/structure/slab2";
import { GlobeRenderer } from "./GlobeRenderer";

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
  onSelect(event: Event | null): void;
  onCameraChange?(camera: { lon: number; lat: number; altitude: number }): void;
  initialCamera?: { lon: number; lat: number; altitude: number } | null;
}

interface Hover {
  event: Event;
  x: number;
  y: number;
}

export function GlobeCanvas({
  events,
  t,
  fadeSeconds,
  onSelect,
  onCameraChange,
  initialCamera,
}: GlobeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GlobeRenderer | null>(null);
  const eventsRef = useRef<Event[]>(events);
  // Mirrored into refs because the renderer is constructed in a later effect
  // pass than the one that first saw these values: without this, a value that
  // never changes again is never applied at all.
  const tRef = useRef(t);
  const fadeRef = useRef(fadeSeconds);
  const pointerRef = useRef({ x: 0, y: 0, down: false, lastX: 0, lastY: 0, dragged: false });
  const [supported, setSupported] = useState<boolean | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  eventsRef.current = events;
  tRef.current = t;
  fadeRef.current = fadeSeconds;

  useEffect(() => {
    setSupported(webglAvailable());
  }, []);

  useEffect(() => {
    if (supported !== true) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = new GlobeRenderer({
      canvas,
      onPick(index) {
        const event = index === null ? null : (eventsRef.current[index] ?? null);
        setHover(
          event === null
            ? null
            : { event, x: pointerRef.current.x, y: pointerRef.current.y },
        );
      },
    });
    rendererRef.current = renderer;
    if (initialCamera) renderer.setCamera(initialCamera);
    // Apply the state the renderer missed by not existing yet. uNow defaults to
    // 0, which in shader time is the year 2000, so skipping this discards the
    // entire catalogue and the globe renders empty.
    renderer.setFadeSeconds(fadeRef.current);
    renderer.setTime(tRef.current);
    renderer.setEvents(eventsRef.current);

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
      // The e2e suite needs a deterministic hover target: probing a grid of
      // pixels finds nothing on a sparse globe.
      Object.defineProperty(window, "__globeTest", {
        configurable: true,
        get: () => ({
          focusOn: (i: number) => renderer.focusOn(i),
          screenPositionOf: (i: number) => renderer.screenPositionOf(i),
        }),
      });
    }

    return () => {
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

  const mechanismsOn = useLayerStore((s) => s.mechanisms);
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

  const slabsOn = useLayerStore((s) => s.slabs);
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

  useEffect(() => {
    rendererRef.current?.setFadeSeconds(fadeSeconds);
  }, [fadeSeconds]);

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

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        data-testid="globe-canvas"
        style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }}
        onPointerDown={(e) => {
          const p = pointerRef.current;
          p.down = true;
          p.dragged = false;
          p.lastX = e.clientX;
          p.lastY = e.clientY;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          const p = pointerRef.current;
          p.down = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
          // A drag is not a click: releasing after rotating must not select.
          if (!p.dragged) onSelect(hover?.event ?? null);
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const p = pointerRef.current;
          p.x = e.clientX - rect.left;
          p.y = e.clientY - rect.top;

          if (p.down) {
            const dx = e.clientX - p.lastX;
            const dy = e.clientY - p.lastY;
            if (Math.abs(dx) + Math.abs(dy) > 2) p.dragged = true;
            p.lastX = e.clientX;
            p.lastY = e.clientY;
            rendererRef.current?.orbitBy(dx, dy);
            onCameraChange?.(rendererRef.current?.getCamera() ?? { lon: 0, lat: 0, altitude: 3.2 });
            setHover(null);
            return;
          }
          setHover((prev) => (prev ? { ...prev, x: p.x, y: p.y } : prev));
          rendererRef.current?.requestPick(p.x, p.y);
        }}
        onPointerLeave={() => {
          pointerRef.current.down = false;
          setHover(null);
        }}
        onWheel={(e) => {
          e.preventDefault();
          rendererRef.current?.zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12);
          onCameraChange?.(rendererRef.current?.getCamera() ?? { lon: 0, lat: 0, altitude: 3.2 });
        }}
      />
      {hover !== null && <HoverTooltip {...hover} />}
    </div>
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
        background: "var(--bg-panel-raised)",
        border: "1px solid var(--line)",
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.5,
        maxWidth: 280,
      }}
    >
      <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
        {formatMagnitude(event.magnitude, event.magType)}
      </div>
      <div style={{ color: "var(--text-dim)" }}>{formatDepth(event.depthKm)}</div>
      <div style={{ color: "var(--text-dim)" }}>{event.place}</div>
      <div style={{ color: "var(--text-faint)" }}>{formatUtc(event.time)}</div>
      <div style={{ color: "var(--text-faint)" }}>
        {event.source.toUpperCase()} · {event.status}
      </div>
    </div>
  );
}
