import { create } from "zustand";

export type LayerName = "labels" | "sunlight" | "xray" | "slabs" | "mechanisms" | "grid";

/** Globe layers. Kept out of the URL state: they are a reading aid, not part of
 *  what a shared link is about. */
export interface LayerState {
  labels: boolean;
  sunlight: boolean;
  /** Translucent ground, hypocenters at true depth. */
  xray: boolean;
  slabs: boolean;
  mechanisms: boolean;
  grid: boolean;
  toggle(layer: LayerName): void;
}

export const useLayerStore = create<LayerState>((set, get) => ({
  labels: true,
  sunlight: true,
  xray: false,
  slabs: false,
  mechanisms: false,
  grid: false,
  toggle(layer) {
    const next = !get()[layer];
    // Slabs are underground: showing them means seeing through the ground.
    // Leaving x-ray hides them again, rather than keeping an invisible layer "on".
    if (layer === "slabs" && next) set({ slabs: true, xray: true });
    else if (layer === "xray" && !next) set({ xray: false, slabs: false });
    else set({ [layer]: next } as Partial<LayerState>);
  },
}));
