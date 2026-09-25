import { beforeEach, describe, expect, it } from "vitest";
import { useLayerStore } from "./layers";

describe("layer store", () => {
  beforeEach(() => useLayerStore.setState({ labels: true, sunlight: true, xray: false, slabs: false, mechanisms: false, grid: false }));

  it("starts as a lit, labelled, opaque planet", () => {
    expect(useLayerStore.getState()).toMatchObject({ labels: true, sunlight: true, xray: false, slabs: false });
  });

  it("turns x-ray on with the slabs, and the slabs off with x-ray", () => {
    useLayerStore.getState().toggle("slabs");
    expect(useLayerStore.getState()).toMatchObject({ slabs: true, xray: true });
    useLayerStore.getState().toggle("xray");
    expect(useLayerStore.getState()).toMatchObject({ slabs: false, xray: false });
  });

  it("toggles the rest independently", () => {
    useLayerStore.getState().toggle("labels");
    useLayerStore.getState().toggle("grid");
    expect(useLayerStore.getState()).toMatchObject({ labels: false, grid: true, xray: false });
  });
});
