/**
 * Chart roles, not raw colours. The three series hues are the first three dark
 * slots of the dataviz reference palette, validated against BOTH of this app's
 * surfaces (#12161a panel, #0a0c0e void) with --pairs all: worst CVD ΔE 9.4,
 * worst normal-vision ΔE 20.9, all ≥ 3:1 contrast. Text never wears a series
 * colour; identity comes from the mark beside it.
 */
export const CHART = {
  observed: "#3987e5", // slot 1: what the catalogue recorded
  model: "#d95926", // slot 2: what a fitted model says
  secondary: "#199e70", // slot 3: a second observed series
  grid: "#232a30", // --line: hairline, solid, recessive
  surface: "#12161a", // --bg-panel: the 2px ring around markers
  textPrimary: "#e7ebee",
  textSecondary: "#7c8790",
  textMuted: "#4d565d",
} as const;

export const VIEW = { width: 640, height: 300, left: 58, right: 18, top: 14, bottom: 46 } as const;

export const plotX = (v: number) => v; // readability alias for viewBox coordinates
export const innerWidth = VIEW.width - VIEW.left - VIEW.right;
export const innerHeight = VIEW.height - VIEW.top - VIEW.bottom;
