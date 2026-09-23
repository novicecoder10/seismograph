// Throwaway spike: end-to-end miniSEED -> canvas -> Web Audio.
import { parseMiniSeed } from "./fetch.js";
import { sonify, type SonifiedBuffer } from "./sonify.js";

declare global {
  interface Window {
    __spike: {
      traceCount: number;
      sampleCount: number;
      sourceRate: number;
      sampleRate: number;
      speedUp: number;
      durationS: number;
      played: boolean;
      error: string | null;
    };
  }
}
window.__spike = {
  traceCount: 0, sampleCount: 0, sourceRate: 0, sampleRate: 0,
  speedUp: 0, durationS: 0, played: false, error: null,
};

const status = document.getElementById("status")!;
const canvas = document.getElementById("wf") as HTMLCanvasElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const pick = document.getElementById("pick") as HTMLSelectElement;

let current: SonifiedBuffer | null = null;

function draw(samples: Float32Array) {
  const ctx = canvas.getContext("2d")!;
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
    ctx.moveTo(x + 0.5, (0.5 - lo * 0.48) * height);
    ctx.lineTo(x + 0.5, (0.5 - hi * 0.48) * height);
  }
  ctx.stroke();
}

async function load(name: string) {
  try {
    status.textContent = `loading ${name}…`;
    const res = await fetch(`/${name}`);
    if (!res.ok) throw new Error(`fixture fetch ${res.status}`);
    const traces = parseMiniSeed(await res.arrayBuffer());
    const t = traces[0]!;
    const audio = sonify(t);
    current = audio;
    Object.assign(window.__spike, {
      traceCount: traces.length,
      sampleCount: audio.samples.length,
      sourceRate: t.sampleRate,
      sampleRate: audio.sampleRate,
      speedUp: audio.speedUp,
      durationS: audio.durationS,
      error: null,
    });
    draw(audio.samples);
    const gaps = Array.from(t.samples).filter((v) => !Number.isFinite(v)).length;
    status.textContent =
      `${t.network}.${t.station}.${t.location}.${t.channel} · ${t.sampleRate} Hz · ` +
      `${t.samples.length} samples · ${gaps} gap samples · ` +
      `${audio.speedUp.toFixed(0)}x · ${audio.durationS.toFixed(2)} s of audio`;
  } catch (e) {
    window.__spike.error = String(e);
    status.textContent = `failed: ${e}`;
  }
}

playBtn.onclick = async () => {
  if (!current) return;
  const ac = new AudioContext();
  await ac.resume();
  const buf = ac.createBuffer(1, current.samples.length, current.sampleRate);
  buf.copyToChannel(current.samples, 0);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.start();
  window.__spike.played = true;
};

pick.onchange = () => void load(pick.value);
void load(pick.value);
