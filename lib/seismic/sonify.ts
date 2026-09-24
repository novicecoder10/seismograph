// Ground motion to an audible buffer. Ported from the Phase 0 spike.
//
// The trick: declare N samples of 100 Hz ground motion at 44,100 Hz. That is a
// free 441x time compression with no resampling. The SeisSound precedent declares
// 20 Hz data at 44.1 kHz for 2205x. `speedUp` reports whatever the ratio actually
// is, so a 50 Hz or 4.5 Hz Raspberry Shake channel needs no separate code path.
import type { Trace } from "./miniseed";

export interface SonifiedBuffer {
  sampleRate: number; // declared playback rate, Hz
  samples: Float32Array; // normalised to [-1, 1], NaN-free
  speedUp: number; // declared rate / source rate
  durationS: number; // playback duration
}

export function sonify(trace: Trace, opts: { targetRate?: number } = {}): SonifiedBuffer {
  const targetRate = opts.targetRate ?? 44100;
  const n = trace.samples.length;
  if (n === 0) throw new Error("cannot sonify an empty trace");
  if (!(trace.sampleRate > 0)) throw new Error(`bad sample rate ${trace.sampleRate}`);

  // Mean over finite samples only. A seismometer carries a large DC offset that
  // would otherwise consume the whole dynamic range.
  let sum = 0;
  let finite = 0;
  for (let i = 0; i < n; i++) {
    const v = trace.samples[i] as number;
    if (Number.isFinite(v)) {
      sum += v;
      finite++;
    }
  }
  const mean = finite > 0 ? sum / finite : 0;

  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = trace.samples[i] as number;
    if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v - mean));
  }

  const out = new Float32Array(n);
  if (peak > 0) {
    const scale = 1 / peak;
    for (let i = 0; i < n; i++) {
      const v = trace.samples[i] as number;
      out[i] = Number.isFinite(v) ? (v - mean) * scale : 0; // gaps -> silence
    }
  }
  // peak === 0 leaves `out` zeroed: a dead channel is silent, never NaN.

  return {
    sampleRate: targetRate,
    samples: out,
    speedUp: targetRate / trace.sampleRate,
    durationS: n / targetRate,
  };
}
