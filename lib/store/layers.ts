import { create } from "zustand";

/** Structural overlays on the globe. Kept out of the URL state: they are a
 *  reading aid, not part of what a shared link is about. */
export interface LayerState {
  slabs: boolean;
  mechanisms: boolean;
  toggle(layer: "slabs" | "mechanisms"): void;
}

export const useLayerStore = create<LayerState>((set, get) => ({
  slabs: true,
  mechanisms: false,
  toggle(layer) {
    set({ [layer]: !get()[layer] } as Partial<LayerState>);
  },
}));
