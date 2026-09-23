import { create } from "zustand";
import type { EventFilter } from "../events/types";
import { useTimeStore } from "./time";
import { decodeViewState, defaultViewState, encodeViewState, type ViewState } from "./url";

export interface FilterState {
  filter: EventFilter;
  view: ViewState["view"];
  camera: ViewState["camera"];
  selectedId: string | null;
  setFilter(patch: Partial<EventFilter>): void;
  setView(view: ViewState["view"]): void;
  setCamera(camera: ViewState["camera"]): void;
  setSelectedId(id: string | null): void;
  hydrateFromUrl(search: string, now?: number): void;
  toQueryString(): string;
}

const INITIAL = defaultViewState();

export const useFilterStore = create<FilterState>((set, get) => ({
  filter: INITIAL.filter,
  view: INITIAL.view,
  camera: INITIAL.camera,
  selectedId: INITIAL.selectedId,

  setFilter(patch) {
    const filter = { ...get().filter, ...patch };
    set({ filter });
    // The filter's range and the time axis are the same window: t lives inside
    // it, so narrowing the filter must re-clamp t rather than strand it.
    if (patch.range) useTimeStore.getState().setRange(patch.range);
  },

  setView(view) {
    set({ view });
  },

  setCamera(camera) {
    set({ camera });
  },

  setSelectedId(selectedId) {
    set({ selectedId });
  },

  hydrateFromUrl(search, now) {
    const v = decodeViewState(search, now);
    set({ filter: v.filter, view: v.view, camera: v.camera, selectedId: v.selectedId });
    const time = useTimeStore.getState();
    time.setRange(v.filter.range);
    time.setRate(v.rate);
    time.setT(v.t);
    // setT detaches from live; restore the followLive state the URL implies.
    time.setFollowLive(v.t === v.filter.range.endMs);
  },

  toQueryString() {
    const f = get();
    const time = useTimeStore.getState();
    return encodeViewState({
      filter: f.filter,
      t: time.t,
      rate: time.rate,
      view: f.view,
      camera: f.camera,
      selectedId: f.selectedId,
    });
  },
}));
