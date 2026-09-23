import { create } from "zustand";
import type { TimeRange } from "../events/types";

export const MIN_RATE = 1;
export const MAX_RATE = 1_000_000;

/** Every t that reaches the store passes through here. URLs are attacker-
 *  controlled input and a NaN t freezes the entire application, since every
 *  view is a function of t. */
export function clampT(t: number, range: TimeRange): number {
  const lo = Math.min(range.startMs, range.endMs);
  const hi = Math.max(range.startMs, range.endMs);
  if (!Number.isFinite(t)) return hi;
  return Math.min(hi, Math.max(lo, t));
}

export function clampRate(rate: number): number {
  if (Number.isNaN(rate)) return MIN_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

export interface TimeState {
  /** The current instant. THE primary axis: the whole application is f(t). */
  t: number;
  /** Playback multiplier; 1 is real time. */
  rate: number;
  playing: boolean;
  /** t tracks wall-clock now. A manual scrub detaches it. */
  followLive: boolean;
  range: TimeRange;
  /** Wall-clock stamp of the previous tick; null resets the baseline. */
  lastTickMs: number | null;
  setT(t: number): void;
  setRate(rate: number): void;
  play(): void;
  pause(): void;
  setRange(range: TimeRange): void;
  setFollowLive(on: boolean): void;
  /** Advance t by the wall-clock delta times the rate. Takes `now` rather than
   *  reading the clock, so playback is deterministic under test and so the
   *  render-on-demand globe can drive it from its own frame callback. */
  tick(nowMs: number): void;
}

function defaultRange(): TimeRange {
  const now = Date.now();
  return { startMs: now - 7 * 86_400_000, endMs: now };
}

const INITIAL = defaultRange();

export const useTimeStore = create<TimeState>((set, get) => ({
  t: INITIAL.endMs,
  rate: 1,
  playing: false,
  followLive: true,
  range: INITIAL,
  lastTickMs: null,

  setT(t) {
    // A manual scrub is a deliberate detach from live.
    set({ t: clampT(t, get().range), followLive: false });
  },

  setRate(rate) {
    set({ rate: clampRate(rate) });
  },

  play() {
    const s = get();
    const hi = Math.max(s.range.startMs, s.range.endMs);
    const lo = Math.min(s.range.startMs, s.range.endMs);
    // Pressing play at the end restarts from the beginning rather than doing
    // nothing, which would look like a broken button.
    set({ playing: true, lastTickMs: null, t: s.t >= hi ? lo : s.t });
  },

  pause() {
    set({ playing: false, lastTickMs: null });
  },

  setRange(range) {
    set({ range, t: clampT(get().t, range) });
  },

  setFollowLive(on) {
    set({ followLive: on });
  },

  tick(nowMs) {
    const s = get();
    if (!s.playing) return;
    if (s.lastTickMs === null) {
      set({ lastTickMs: nowMs });
      return;
    }
    const wallDelta = nowMs - s.lastTickMs;
    if (!Number.isFinite(wallDelta) || wallDelta <= 0) {
      set({ lastTickMs: nowMs });
      return;
    }
    const next = s.t + wallDelta * s.rate;
    const hi = Math.max(s.range.startMs, s.range.endMs);
    if (next >= hi) {
      // Reaching the end stops playback. It does not wrap, and it does not run
      // past the end into a window with no data.
      set({ t: hi, playing: false, lastTickMs: null });
      return;
    }
    set({ t: clampT(next, s.range), lastTickMs: nowMs });
  },
}));
