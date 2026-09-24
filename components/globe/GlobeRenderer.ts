import * as THREE from "three";
import type { Event } from "@/lib/events/types";
import {
  buildHypocenterBuffers,
  decodeId,
  toShaderTime,
  type HypocenterBuffers,
} from "./hypocenters";
import { unprojectDirection } from "@/lib/geo/project";
import { makeGraticule } from "./graticule";
import { makeDisplayMaterial, makePickMaterial, makeShellMaterial } from "./materials";
import { makeMechanisms } from "./mechanisms";
import { makeSlabs } from "./slabs";
import type { Mechanism } from "@/lib/structure/mechanism";
import { makeStations, makeWavefront, type StationMarker, type WavefrontInput } from "./wavefront";
import type { Slab } from "@/lib/structure/slab2";

/**
 * PHASE 0 FINDING, ENFORCED HERE (spikes/FINDINGS.md §2):
 *
 * A GPU pick read back against a continuously rendering rAF loop costs 11,495 ms
 * at 1,000,000 points, against 0.3 ms with the loop paused, because readPixels
 * must drain the frame queue before it can return. The display frame time
 * degrades in step, 16.7 ms becoming 3,983 ms, so the whole application stops
 * responding. readRenderTargetPixelsAsync does NOT fix it — 1,766 ms against
 * 1,852 ms at 100k points — because the cost is the drain, not the synchronous
 * call.
 *
 * Therefore:
 *   1. There is no continuous loop. A frame runs only when something changed.
 *   2. A pick is serviced INSIDE a frame, before the display draw, so the queue
 *      it drains is at most one frame deep.
 *   3. At most one pick per frame; intermediate pointer moves are dropped.
 *   4. The pick target is warmed at construction, because the first pick at 1M
 *      points cost 7 s against a 5.7 ms median.
 */
export interface GlobeRendererOptions {
  canvas: HTMLCanvasElement;
  onPick?(index: number | null): void;
}

export interface GlobeStats {
  frames: number;
  renders: number;
  picks: number;
  lastFrameMs: number;
  lastPickMs: number;
  pointCount: number;
  mechanismCount: number;
}

export class GlobeRenderer {
  readonly stats: GlobeStats = {
    frames: 0,
    renders: 0,
    picks: 0,
    lastFrameMs: 0,
    lastPickMs: 0,
    pointCount: 0,
    mechanismCount: 0,
  };

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly shell: THREE.Mesh;
  private readonly graticule: THREE.LineSegments;
  private readonly displayMaterial = makeDisplayMaterial();
  private readonly pickMaterial = makePickMaterial();
  private readonly pickTarget = new THREE.WebGLRenderTarget(1, 1);
  private readonly pickPixel = new Uint8Array(4);

  private points: THREE.Points | null = null;
  private wave: ReturnType<typeof makeWavefront> | null = null;
  private stationLayer: ReturnType<typeof makeStations> | null = null;
  private slabs: THREE.Mesh | null = null;
  private mechanisms: ReturnType<typeof makeMechanisms> | null = null;
  private nowShader = 0;
  private buffers: HypocenterBuffers | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private frameHandle: number | null = null;
  private pendingPick: { x: number; y: number } | null = null;
  private disposed = false;

  /** Camera orientation, driven by drag. Altitude is the distance in scene units. */
  private orbit = { lon: 0, lat: 0, altitude: 3.2 };

  constructor(private readonly opts: GlobeRendererOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.setClearColor(0x0a0c0e, 1);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.applyOrbit();

    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), makeShellMaterial());
    this.scene.add(this.shell);
    this.graticule = makeGraticule();
    this.scene.add(this.graticule);

    // Warm the pick path now rather than on the first hover.
    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);
  }

  setEvents(events: Event[]): void {
    this.buffers = buildHypocenterBuffers(events);
    this.uploadBuffers(this.buffers);
    this.stats.pointCount = events.length;
    this.requestRender();
  }

  /** Sets the current instant. Events after t are discarded by the shader, so
   *  catalogue replay is a uniform update rather than a rebuild. */
  setTime(tMs: number): void {
    const shaderTime = toShaderTime(tMs);
    this.displayMaterial.uniforms.uNow!.value = shaderTime;
    this.pickMaterial.uniforms.uNow!.value = shaderTime;
    this.nowShader = shaderTime;
    if (this.mechanisms) this.mechanisms.material.uniforms.uNow!.value = shaderTime;
    this.requestRender();
  }

  /** How long an event stays visually "recent", in seconds of catalogue time. */
  setFadeSeconds(seconds: number): void {
    this.displayMaterial.uniforms.uFadeSeconds!.value = Math.max(1, seconds);
    this.requestRender();
  }

  /** Focal mechanisms as 3D beachballs; null removes them. */
  setMechanisms(ms: Mechanism[] | null): void {
    if (this.mechanisms) {
      this.scene.remove(this.mechanisms.points);
      this.mechanisms.points.geometry.dispose();
      this.mechanisms.material.dispose();
      this.mechanisms = null;
    }
    this.stats.mechanismCount = ms?.length ?? 0;
    // With mechanisms shown, hypocenters step back to small dots so the
    // beachballs, which carry more information, are not buried under glows.
    this.displayMaterial.uniforms.uPointScale!.value = ms && ms.length ? 3.5 : 8.0;
    if (ms && ms.length) {
      this.mechanisms = makeMechanisms(ms);
      this.mechanisms.material.uniforms.uNow!.value = this.nowShader;
      this.scene.add(this.mechanisms.points);
    }
    this.requestRender();
  }

  /** Slab2 surfaces; null removes them. */
  setSlabs(slabs: Slab[] | null): void {
    if (this.slabs) {
      this.scene.remove(this.slabs);
      this.slabs.geometry.dispose();
      (this.slabs.material as THREE.Material).dispose();
      this.slabs = null;
    }
    if (slabs && slabs.length) {
      this.slabs = makeSlabs(slabs);
      this.scene.add(this.slabs);
    }
    this.requestRender();
  }

  /** Wavefronts for one event; null removes them. */
  setWavefront(w: WavefrontInput | null): void {
    if (this.wave) {
      this.scene.remove(this.wave.mesh);
      this.wave.mesh.geometry.dispose();
      this.wave.material.dispose();
      this.wave.texture.dispose();
      this.wave = null;
    }
    if (w) {
      this.wave = makeWavefront(w);
      this.scene.add(this.wave.mesh);
    }
    this.requestRender();
  }

  /** Seconds since the event's origin; negative hides the fronts. */
  setWaveTime(seconds: number): void {
    if (!this.wave) return;
    this.wave.material.uniforms.uT!.value = seconds;
    this.requestRender();
  }

  setStations(stations: StationMarker[]): void {
    if (this.stationLayer) {
      this.scene.remove(this.stationLayer.points);
      this.stationLayer.points.geometry.dispose();
      (this.stationLayer.points.material as THREE.Material).dispose();
      this.stationLayer = null;
    }
    if (stations.length) {
      this.stationLayer = makeStations(stations);
      this.scene.add(this.stationLayer.points);
    }
    this.requestRender();
  }

  /** For tests: how many stations are drawn, and their current brightness. */
  stationDebug(): { count: number; brightness: number[] } {
    const b = this.stationLayer?.brightness;
    return { count: b?.count ?? 0, brightness: b ? Array.from(b.array as Float32Array) : [] };
  }

  /** 0..1 per station, in setStations order. */
  setStationBrightness(values: ArrayLike<number>): void {
    const b = this.stationLayer?.brightness;
    if (!b) return;
    for (let i = 0; i < b.count; i++) {
      const v = values[i] ?? 0;
      // A NaN reaching gl_PointSize is undefined behaviour: one bad sample drew
      // a station as a disc covering 25° of the globe.
      b.setX(i, Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
    }
    b.needsUpdate = true;
    this.requestRender();
  }

  setCamera(camera: { lon: number; lat: number; altitude: number }): void {
    this.orbit = { ...camera };
    this.applyOrbit();
    this.requestRender();
  }

  getCamera(): { lon: number; lat: number; altitude: number } {
    return { ...this.orbit };
  }

  /** Orients the camera at an event so a shared link carrying `sel=` opens
   *  looking at it, rather than at whatever the default view is. */
  focusOn(index: number): boolean {
    const b = this.buffers;
    if (b === null || index < 0 || index >= b.count) return false;
    const x = b.positions[index * 3] as number;
    const y = b.positions[index * 3 + 1] as number;
    const z = b.positions[index * 3 + 2] as number;
    const { lat, lon } = unprojectDirection(x, y, z);
    this.orbit = { lon, lat, altitude: this.orbit.altitude };
    this.applyOrbit();
    this.requestRender();
    return true;
  }

  /** Where an event sits on screen, in CSS pixels, or null when it is behind the
   *  camera or off screen. Used to place labels and leader lines. */
  screenPositionOf(index: number): { x: number; y: number } | null {
    const b = this.buffers;
    if (b === null || index < 0 || index >= b.count) return null;
    const v = new THREE.Vector3(
      b.positions[index * 3] as number,
      b.positions[index * 3 + 1] as number,
      b.positions[index * 3 + 2] as number,
    );
    this.camera.updateMatrixWorld();
    v.project(this.camera);
    if (v.z < -1 || v.z > 1) return null;
    const rect = this.renderer.domElement;
    const dpr = this.renderer.getPixelRatio();
    const width = rect.width / dpr;
    const height = rect.height / dpr;
    const x = ((v.x + 1) / 2) * width;
    const y = ((1 - v.y) / 2) * height;
    if (x < 0 || y < 0 || x > width || y > height) return null;
    return { x, y };
  }

  /** Drag handler: degrees per pixel scaled by altitude so a zoomed-in drag
   *  moves the same apparent distance. */
  orbitBy(dxPixels: number, dyPixels: number): void {
    const scale = 0.25 * (this.orbit.altitude / 3.2);
    this.orbit.lon = ((this.orbit.lon - dxPixels * scale + 540) % 360) - 180;
    this.orbit.lat = Math.min(89, Math.max(-89, this.orbit.lat + dyPixels * scale));
    this.applyOrbit();
    this.requestRender();
  }

  zoomBy(factor: number): void {
    this.orbit.altitude = Math.min(50, Math.max(1.05, this.orbit.altitude * factor));
    this.applyOrbit();
    this.requestRender();
  }

  requestRender(): void {
    if (this.disposed || this.frameHandle !== null) return;
    this.frameHandle = requestAnimationFrame(() => this.frame());
  }

  requestPick(x: number, y: number): void {
    // Last pointer position wins. Intermediate moves are dropped rather than
    // queued, so a fast sweep costs one pick per frame, not one per event.
    this.pendingPick = { x, y };
    this.requestRender();
  }

  private applyOrbit(): void {
    const latRad = (this.orbit.lat * Math.PI) / 180;
    const lonRad = (this.orbit.lon * Math.PI) / 180;
    const r = this.orbit.altitude;
    this.camera.position.set(
      r * Math.cos(latRad) * Math.cos(lonRad),
      r * Math.sin(latRad),
      r * Math.cos(latRad) * Math.sin(lonRad),
    );
    this.camera.lookAt(0, 0, 0);
  }

  private frame(): void {
    this.frameHandle = null;
    if (this.disposed) return;
    const t0 = performance.now();

    if (this.pendingPick !== null) {
      const { x, y } = this.pendingPick;
      this.pendingPick = null;
      const p0 = performance.now();
      const index = this.points === null ? null : this.pickAt(x, y);
      this.stats.lastPickMs = performance.now() - p0;
      this.stats.picks++;
      this.opts.onPick?.(index);
    }

    this.renderer.setRenderTarget(null);
    if (this.mechanisms) {
      this.camera.updateMatrixWorld();
      (this.mechanisms.material.uniforms.uViewInv!.value as THREE.Matrix3).setFromMatrix4(this.camera.matrixWorld);
    }
    this.renderer.render(this.scene, this.camera);
    this.stats.renders++;
    this.stats.frames++;
    this.stats.lastFrameMs = performance.now() - t0;
  }

  private pickAt(x: number, y: number): number | null {
    const points = this.points;
    if (points === null) return null;
    const dpr = this.renderer.getPixelRatio();
    const cam = this.camera.clone();
    cam.setViewOffset(
      this.renderer.domElement.width,
      this.renderer.domElement.height,
      Math.floor(x * dpr),
      Math.floor(y * dpr),
      1,
      1,
    );
    points.material = this.pickMaterial;
    this.shell.visible = false;
    this.graticule.visible = false;
    if (this.wave) this.wave.mesh.visible = false;
    if (this.stationLayer) this.stationLayer.points.visible = false;
    if (this.slabs) this.slabs.visible = false;
    if (this.mechanisms) this.mechanisms.points.visible = false;
    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    this.renderer.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, this.pickPixel);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x0a0c0e, 1);
    this.shell.visible = true;
    this.graticule.visible = true;
    if (this.wave) this.wave.mesh.visible = true;
    if (this.stationLayer) this.stationLayer.points.visible = true;
    if (this.slabs) this.slabs.visible = true;
    if (this.mechanisms) this.mechanisms.points.visible = true;
    points.material = this.displayMaterial;
    return decodeId(this.pickPixel[0]!, this.pickPixel[1]!, this.pickPixel[2]!);
  }

  private uploadBuffers(b: HypocenterBuffers): void {
    this.geometry?.dispose();
    if (this.points !== null) this.scene.remove(this.points);
    if (b.count === 0) {
      this.geometry = null;
      this.points = null;
      return;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
    geom.setAttribute("aMag", new THREE.BufferAttribute(b.magnitudes, 1));
    geom.setAttribute("aDepth", new THREE.BufferAttribute(b.depths, 1));
    geom.setAttribute("aTime", new THREE.BufferAttribute(b.times, 1));
    geom.setAttribute("aId", new THREE.BufferAttribute(b.ids, 3));
    this.geometry = geom;
    this.points = new THREE.Points(geom, this.displayMaterial);
    // Frustum culling uses the bounding sphere, which for a globe is always in
    // view; computing it on every upload costs more than it saves.
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.requestRender();
  }

  dispose(): void {
    this.setWavefront(null);
    this.setStations([]);
    this.setSlabs(null);
    this.setMechanisms(null);
    this.disposed = true;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.geometry?.dispose();
    this.pickTarget.dispose();
    this.displayMaterial.dispose();
    this.pickMaterial.dispose();
    this.shell.geometry.dispose();
    this.graticule.geometry.dispose();
    (this.graticule.material as THREE.Material).dispose();
    (this.shell.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
