"use client";

import { useEffect, useRef, useState } from "react";
import type { Trace } from "@/lib/seismic/miniseed";
import { sonify, type SonifiedBuffer } from "@/lib/seismic/sonify";
import type { StationWithDistance } from "@/lib/seismic/stations";
import { findNearestTrace } from "@/lib/seismic/traces";

export interface WaveformPanelProps {
  lat: number;
  lon: number;
  timeMs: number;
}

interface Loaded {
  station: StationWithDistance;
  trace: Trace;
  audio: SonifiedBuffer;
}

type State =
  | { kind: "loading"; what: string }
  | { kind: "none"; why: string }
  | { kind: "error"; why: string }
  | { kind: "ready"; data: Loaded };

export function WaveformPanel({ lat, lon, timeMs }: WaveformPanelProps) {
  const [state, setState] = useState<State>({ kind: "loading", what: "finding a station" });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await findNearestTrace(lat, lon, timeMs, {
        onProgress: (what) => {
          if (!cancelled) setState({ kind: "loading", what });
        },
      });
      if (cancelled) return;
      if (result.kind === "ok") {
        const { station, trace } = result.value;
        setState({ kind: "ready", data: { station, trace, audio: sonify(trace) } });
      } else {
        setState({ kind: result.kind, why: result.why });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lon, timeMs]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    const { samples } = state.data.audio;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#7fe0c5";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(samples.length / width));
    for (let x = 0; x < width; x++) {
      let lo = 1;
      let hi = -1;
      for (let k = 0; k < step; k++) {
        const v = samples[x * step + k];
        if (v === undefined) break;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (lo > hi) continue;
      ctx.moveTo(x + 0.5, (0.5 - lo * 0.46) * height);
      ctx.lineTo(x + 0.5, (0.5 - hi * 0.46) * height);
    }
    ctx.stroke();
  }, [state]);

  const play = () => {
    if (state.kind !== "ready") return;
    const { audio } = state.data;
    const ac = new AudioContext();
    void ac.resume().then(() => {
      const buf = ac.createBuffer(1, audio.samples.length, audio.sampleRate);
      buf.copyToChannel(new Float32Array(audio.samples), 0);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.start();
    });
  };

  return (
    <section
      data-testid="waveform-panel"
      style={{
        border: "1px solid var(--line)",
        background: "var(--bg-panel)",
        padding: "14px 16px",
        marginBottom: 14,
      }}
    >
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 13,
          margin: "0 0 8px",
          color: "var(--text-primary)",
        }}
      >
        Ground motion
      </h3>

      {state.kind === "loading" && (
        <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>{state.what}…</p>
      )}

      {(state.kind === "none" || state.kind === "error") && (
        <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>
          {state.why} The rest of this page is unaffected.
        </p>
      )}

      {state.kind === "ready" && (
        <>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 4px" }}>
            Recorded at{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              {state.data.station.network}.{state.data.station.station}
            </strong>
            , {state.data.station.distanceKm.toFixed(0)} km from the epicentre, at{" "}
            {state.data.trace.sampleRate} Hz.
          </p>
          <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "0 0 10px" }}>
            This is what one station recorded, not the motion at the epicentre. Played back at{" "}
            {state.data.audio.speedUp.toFixed(0)}× real time — ground motion is below human
            hearing, so it is audible only when compressed.
          </p>
          <canvas
            ref={canvasRef}
            data-testid="waveform-canvas"
            width={1600}
            height={180}
            style={{
              width: "100%",
              height: 180,
              display: "block",
              background: "var(--bg-void)",
              border: "1px solid var(--line)",
            }}
          />
          <button
            data-testid="waveform-play"
            onClick={play}
            style={{
              marginTop: 10,
              background: "var(--bg-panel-raised)",
              color: "#7fe0c5",
              border: "1px solid var(--line)",
              padding: "6px 16px",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            listen ({state.data.audio.durationS.toFixed(1)} s)
          </button>
        </>
      )}
    </section>
  );
}
