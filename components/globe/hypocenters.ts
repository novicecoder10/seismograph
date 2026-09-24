import type { Event } from "@/lib/events/types";
import { projectHypocenter } from "@/lib/geo/project";

/** IDs are encoded as RGB with 0 reserved for "nothing picked", so the usable
 *  space is 2^24 - 1 = 16,777,215 — two orders of magnitude beyond the M4.5+
 *  catalogue, and beyond the 1,000,000 points Phase 0 measured at 60fps. */
export const MAX_PICKABLE_EVENTS = 0xff_ff_ff - 1;

export interface HypocenterBuffers {
  positions: Float32Array;
  magnitudes: Float32Array;
  depths: Float32Array;
  /** Event times, so the shader can reveal events as t passes them. */
  times: Float32Array;
  ids: Float32Array;
  count: number;
}

export function buildHypocenterBuffers(events: Event[]): HypocenterBuffers {
  if (events.length > MAX_PICKABLE_EVENTS) {
    throw new Error(
      `${events.length} events exceeds the 24-bit pick id space (${MAX_PICKABLE_EVENTS})`,
    );
  }
  const n = events.length;
  const positions = new Float32Array(n * 3);
  const magnitudes = new Float32Array(n);
  const depths = new Float32Array(n);
  const times = new Float32Array(n);
  const ids = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const e = events[i]!;
    const [x, y, z] = projectHypocenter(e.lat, e.lon, e.depthKm);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    magnitudes[i] = e.magnitude;
    // A null depth is not a depth of zero, but the shader needs a number. It
    // colours as shallow, which is the honest default: unknown depth is almost
    // always a poorly constrained shallow event.
    depths[i] = e.depthKm ?? 0;
    // Float32 holds a millisecond epoch to about 2^24 ms precision, roughly
    // 4.7 hours — far too coarse. Seconds since 2000 fits with ~1s precision.
    times[i] = (e.time - Date.UTC(2000, 0, 1)) / 1000;

    const id = i + 1; // 0 is "nothing"
    ids[i * 3] = ((id >> 16) & 255) / 255;
    ids[i * 3 + 1] = ((id >> 8) & 255) / 255;
    ids[i * 3 + 2] = (id & 255) / 255;
  }

  return { positions, magnitudes, depths, times, ids, count: n };
}

export function decodeId(r: number, g: number, b: number): number | null {
  const id = (r << 16) | (g << 8) | b;
  return id === 0 ? null : id - 1;
}

/** The shader's time origin, in the same units as the `times` buffer. */
export function toShaderTime(ms: number): number {
  return (ms - Date.UTC(2000, 0, 1)) / 1000;
}
