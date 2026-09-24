import { CHART } from "../charts/theme";

/** Phase colours: P and S are the two a reader follows; later phases share the
 *  third slot and are named in the legend. Validated palette (components/charts/theme). */
export const PHASE_STYLE: Record<string, { colour: string; rgb: [number, number, number]; label: string }> = {
  P: { colour: CHART.observed, rgb: [0.224, 0.529, 0.898], label: "P (compressional)" },
  S: { colour: CHART.model, rgb: [0.851, 0.349, 0.149], label: "S (shear)" },
  PP: { colour: CHART.secondary, rgb: [0.098, 0.62, 0.439], label: "later phases: PP, PKP, ScS" },
  PKP: { colour: CHART.secondary, rgb: [0.098, 0.62, 0.439], label: "later phases: PP, PKP, ScS" },
  ScS: { colour: CHART.secondary, rgb: [0.098, 0.62, 0.439], label: "later phases: PP, PKP, ScS" },
};

export const FILTERS = [
  { id: "broad", label: "broadband 0.02–2 Hz", low: 0.02, high: 2 },
  { id: "long", label: "long period 0.01–0.1 Hz (surface waves)", low: 0.01, high: 0.1 },
  { id: "short", label: "short period 1–8 Hz (local)", low: 1, high: 8 },
] as const;
export type FilterId = (typeof FILTERS)[number]["id"];

/** Seconds before origin that every trace starts, and the section's span. */
export const PRE_S = 60;
export const SPAN_S = 1800;
