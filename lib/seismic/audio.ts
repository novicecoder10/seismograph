import { bandpass } from "./dsp";

/**
 * Sonification. Seismic motion (0.01–20 Hz) becomes audible by playing it
 * faster: declaring 20 Hz broadband data at 20 kHz is a 1000× speed-up and moves
 * 0.05–10 Hz to 50 Hz–10 kHz. The same speed drives the page clock, so sound,
 * record section and globe stay on one instant.
 */

/** Web Audio accepts buffer rates in [3000, 768000] Hz. */
export const MIN_BUFFER_RATE = 3000;
export const MAX_BUFFER_RATE = 768000;
export const SPEEDS = [100, 300, 1000, 3000] as const;

/** The declared playback rate for a speed-up, and the decimation needed to fit
 *  Web Audio's range. Speed is honoured exactly: decimating by k while declaring
 *  rate/k plays at the same speed. */
export function playbackPlan(sourceRate: number, speed: number): { declaredRate: number; decimate: number } {
  let decimate = 1;
  let rate = sourceRate * speed;
  while (rate / decimate > MAX_BUFFER_RATE) decimate++;
  rate /= decimate;
  return { declaredRate: Math.max(MIN_BUFFER_RATE, rate), decimate };
}

/** Normalised, gap-free, optionally decimated samples ready for an AudioBuffer. */
export function audioSamples(x: Float32Array, decimate = 1): Float32Array<ArrayBuffer> {
  const n = Math.floor(x.length / decimate);
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i * decimate]!;
    out[i] = Number.isFinite(v) ? v : 0;
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  if (peak > 0) for (let i = 0; i < n; i++) out[i]! /= peak;
  return out;
}

/** Listener at the epicentre facing north: east is right, west is left. */
export function panFromAzimuth(azimuthDeg: number): number {
  return Math.max(-1, Math.min(1, Math.sin((azimuthDeg * Math.PI) / 180)));
}

/**
 * The voltage-controlled-oscillator channel (after SeisSound): long-period motion
 * below `cutoffHz` is too slow to hear even sped up, so it sets the pitch of an
 * audible oscillator instead. Returns a frequency curve for
 * `AudioParam.setValueCurveAtTime`, `points` long.
 */
export function vcoCurve(x: Float32Array, sourceRate: number, opts: { cutoffHz?: number; baseHz?: number; octaves?: number; points?: number } = {}): Float32Array {
  const lp = bandpass(x.map((v) => (Number.isFinite(v) ? v : 0)), sourceRate, null, opts.cutoffHz ?? 0.1);
  let peak = 0;
  for (const v of lp) peak = Math.max(peak, Math.abs(v));
  const points = Math.max(2, opts.points ?? 512);
  const base = opts.baseHz ?? 220;
  const oct = opts.octaves ?? 1.5;
  const out = new Float32Array(points);
  for (let k = 0; k < points; k++) {
    const v = peak > 0 ? lp[Math.min(lp.length - 1, Math.floor((k / (points - 1)) * (lp.length - 1)))]! / peak : 0;
    out[k] = base * 2 ** (oct * v);
  }
  return out;
}

/** A logarithmic sweep of the band-pass centre, `points` long, for the filter's
 *  frequency parameter: it lets a listener hear which band each phase lives in. */
export function sweepCurve(fromHz: number, toHz: number, points = 256): Float32Array {
  const out = new Float32Array(points);
  const a = Math.log(fromHz), b = Math.log(toHz);
  for (let k = 0; k < points; k++) out[k] = Math.exp(a + ((b - a) * k) / (points - 1));
  return out;
}

export interface PlayOptions {
  samples: Float32Array;
  sourceRate: number;
  speed: number;
  /** Seconds of seismic time into the trace to start from. */
  offsetS: number;
  azimuthDeg: number;
  filter: { centreHz: number; q: number; sweep: boolean } | null;
  vco: boolean;
}

export interface Playing {
  stop(): void;
  /** Seismic seconds since the trace start, for the page clock. */
  positionS(): number;
  ended: Promise<void>;
}

/** Browser only. The caller must create `ctx` in a user gesture. */
export function play(ctx: AudioContext, o: PlayOptions): Playing {
  const { declaredRate, decimate } = playbackPlan(o.sourceRate, o.speed);
  const data = audioSamples(o.samples, decimate);
  const buffer = ctx.createBuffer(1, Math.max(1, data.length), declaredRate);
  buffer.copyToChannel(data, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const pan = ctx.createStereoPanner();
  pan.pan.value = panFromAzimuth(o.azimuthDeg);
  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  let head: AudioNode = src;
  const nodes: AudioNode[] = [src];
  const audibleDuration = Math.max(0.05, data.length / declaredRate - o.offsetS / o.speed);
  if (o.filter) {
    const bq = ctx.createBiquadFilter();
    bq.type = "bandpass";
    bq.Q.value = o.filter.q;
    if (o.filter.sweep) bq.frequency.setValueCurveAtTime(sweepCurve(60, 8000), ctx.currentTime, audibleDuration);
    else bq.frequency.value = o.filter.centreHz;
    head.connect(bq);
    head = bq;
    nodes.push(bq);
  }
  head.connect(pan).connect(gain).connect(ctx.destination);
  const startedAt = ctx.currentTime;
  src.start(startedAt, o.offsetS / o.speed);

  let osc: OscillatorNode | null = null;
  if (o.vco) {
    osc = ctx.createOscillator();
    osc.type = "sine";
    const g = ctx.createGain();
    g.gain.value = 0.15;
    const startIdx = Math.floor(o.offsetS * o.sourceRate);
    osc.frequency.setValueCurveAtTime(vcoCurve(o.samples.subarray(startIdx), o.sourceRate), startedAt, audibleDuration);
    osc.connect(g).connect(pan);
    osc.start(startedAt);
    osc.stop(startedAt + audibleDuration);
  }
  const ended = new Promise<void>((resolve) => (src.onended = () => resolve()));
  return {
    stop() {
      try { src.stop(); } catch { /* already stopped */ }
      try { osc?.stop(); } catch { /* already stopped */ }
      for (const n of nodes) n.disconnect();
      pan.disconnect();
    },
    positionS: () => o.offsetS + (ctx.currentTime - startedAt) * o.speed,
    ended,
  };
}
