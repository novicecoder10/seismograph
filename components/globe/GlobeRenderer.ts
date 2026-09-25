import * as THREE from "three";
import type { Event } from "@/lib/events/types";
import {
  buildHypocenterBuffers,
  decodeId,
  toShaderTime,
  type HypocenterBuffers,
} from "./hypocenters";
import { unprojectDirection } from "@/lib/geo/project";
import { sunDirection } from "@/lib/geo/sun";
import { cameraPose, clampState, DEFAULT_CAMERA, EARTH_KM, flyPath, raySphere, rotateBy, type CameraState, type V3 } from "@/lib/globe/camera";
import { EarthLayer, makeAtmosphere, makeStars } from "./earth";
import { makeGraticule } from "./graticule";
import { EPICENTRE_LIFT, makeDisplayMaterial, makePickMaterial } from "./materials";
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
  /** Called after any camera change, including animation frames. */
  onCameraChange?(camera: CameraState): void;
}

export interface GlobeStats {
  frames: number;
  renders: number;
  picks: number;
  lastFrameMs: number;
  lastPickMs: number;
  pointCount: number;
  mechanismCount: number;
  tilesDrawn: number;
  tilesPending: number;
  tileLevel: number;
  animating: boolean;
}

/** Seconds for the x-ray transition: long enough to watch the hypocenters sink. */
const XRAY_SECONDS = 1.1;
const XRAY_GROUND_OPACITY = 0.3;

export class GlobeRenderer {
  readonly stats: GlobeStats = {
    frames: 0,
    renders: 0,
    picks: 0,
    lastFrameMs: 0,
    lastPickMs: 0,
    pointCount: 0,
    mechanismCount: 0,
    tilesDrawn: 0,
    tilesPending: 0,
    tileLevel: 0,
    animating: false,
  };

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly starScene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly starCamera: THREE.PerspectiveCamera;
  private readonly earth: EarthLayer;
  private readonly atmosphere: ReturnType<typeof makeAtmosphere>;
  private readonly stars: THREE.Points;
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
  private nowMs = Date.now();
  private sunlight = true;
  private buffers: HypocenterBuffers | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private frameHandle: number | null = null;
  private pendingPick: { x: number; y: number } | null = null;
  private disposed = false;
  private viewportHeight = 1;

  private cam: CameraState = { ...DEFAULT_CAMERA };
  private xray = { value: 0, target: 0 };
  private flight: { from: CameraState; to: CameraState; start: number; ms: number } | null = null;
  private spin: { dLon: number; dLat: number } | null = null;
  private lastFrameTime = 0;

  constructor(private readonly opts: GlobeRendererOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = false;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.starCamera = new THREE.PerspectiveCamera(45, 1, 1, 200);

    this.earth = new EarthLayer(() => this.requestRender());
    this.scene.add(this.earth.group);
    this.atmosphere = makeAtmosphere();
    this.scene.add(this.atmosphere.mesh);
    this.stars = makeStars();
    (this.stars.material as THREE.ShaderMaterial).uniforms.uPixelRatio!.value = this.renderer.getPixelRatio();
    this.starScene.add(this.stars);
    this.graticule = makeGraticule();
    this.graticule.visible = false;
    this.scene.add(this.graticule);
    this.setSunlight(true);
    this.applyCamera();

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
   *  catalogue replay is a uniform update rather than a rebuild. The Sun follows
   *  the same clock. */
  setTime(tMs: number): void {
    const shaderTime = toShaderTime(tMs);
    this.displayMaterial.uniforms.uNow!.value = shaderTime;
    this.pickMaterial.uniforms.uNow!.value = shaderTime;
    this.nowShader = shaderTime;
    this.nowMs = tMs;
    if (this.mechanisms) this.mechanisms.material.uniforms.uNow!.value = shaderTime;
    this.updateSun();
    this.requestRender();
  }

  /** How long an event stays visually "recent", in seconds of catalogue time. */
  setFadeSeconds(seconds: number): void {
    this.displayMaterial.uniforms.uFadeSeconds!.value = Math.max(1, seconds);
    this.requestRender();
  }

  /** Real sunlight at the current instant, or the whole planet evenly lit. */
  setSunlight(on: boolean): void {
    this.sunlight = on;
    this.updateSun();
    this.requestRender();
  }

  private updateSun(): void {
    const d = sunDirection(this.nowMs);
    this.earth.setSunlight(this.sunlight, d);
    this.atmosphere.material.uniforms.uSunlight!.value = this.sunlight ? 1 : 0;
    (this.atmosphere.material.uniforms.uSun!.value as THREE.Vector3).set(...d);
  }

  setLabels(on: boolean): void {
    this.earth.setLabels(on);
    this.requestRender();
  }

  /** Real relief (AWS Terrain Tiles) under the imagery, or a smooth sphere. */
  setTerrain(on: boolean): void {
    this.earth.setTerrain(on);
    this.applyCamera();
    this.requestRender();
  }

  /** Metres above sea level at a point, from the terrain loaded so far. */
  elevationAt(lat: number, lon: number): number {
    return this.earth.elevationAt(lat, lon);
  }

  setGrid(on: boolean): void {
    this.graticule.visible = on;
    this.requestRender();
  }

  /**
   * X-ray: the ground turns translucent and every hypocenter sinks from its
   * epicentre to its true depth. Off, the planet is opaque and events sit on
   * the surface where they would be felt.
   */
  setXray(on: boolean, animate = true): void {
    this.xray.target = on ? 1 : 0;
    if (!animate) this.xray.value = this.xray.target;
    this.applyXray();
    this.requestRender();
  }

  get xrayOn(): boolean {
    return this.xray.target > 0.5;
  }

  private applyXray(): void {
    const v = this.xray.value;
    const eased = v * v * (3 - 2 * v);
    this.displayMaterial.uniforms.uXray!.value = eased;
    this.pickMaterial.uniforms.uXray!.value = eased;
    if (this.mechanisms) this.mechanisms.material.uniforms.uXray!.value = eased;
    this.earth.setOpacity(1 - (1 - XRAY_GROUND_OPACITY) * eased);
    if (this.slabs) {
      this.slabs.visible = eased > 0.02;
      (this.slabs.material as THREE.RawShaderMaterial).uniforms.uFade!.value = eased;
    }
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
      this.applyXray();
    }
    this.requestRender();
  }

  /** Slab2 surfaces; null removes them. They are underground, so they show in x-ray. */
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
      this.applyXray();
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

  // ---- Camera ------------------------------------------------------------

  setCamera(camera: Partial<CameraState> & { lon: number; lat: number; altitude: number }): void {
    this.flight = null;
    this.spin = null;
    this.cam = clampState({ heading: 0, tilt: 0, ...camera });
    this.applyCamera();
    this.requestRender();
  }

  getCamera(): CameraState {
    return { ...this.cam };
  }

  /** Animated flight to a view. Interrupted by any direct camera input. */
  flyTo(to: Partial<CameraState> & { lon: number; lat: number }, ms = 1600): void {
    const target = clampState({ ...this.cam, heading: 0, tilt: 0, ...to, altitude: to.altitude ?? this.cam.altitude });
    this.spin = null;
    this.flight = { from: { ...this.cam }, to: target, start: performance.now(), ms };
    this.requestRender();
  }

  /** Orients the camera at an event so a shared link carrying `sel=` opens
   *  looking at it, rather than at whatever the default view is. */
  focusOn(index: number): boolean {
    const b = this.buffers;
    if (b === null || index < 0 || index >= b.count) return false;
    const { lat, lon } = unprojectDirection(b.positions[index * 3]!, b.positions[index * 3 + 1]!, b.positions[index * 3 + 2]!);
    this.setCamera({ ...this.cam, lon, lat });
    return true;
  }

  /** The event's lat/lon, for callers that fly to a picked event. */
  positionOf(index: number): { lat: number; lon: number } | null {
    const b = this.buffers;
    if (b === null || index < 0 || index >= b.count) return null;
    return unprojectDirection(b.positions[index * 3]!, b.positions[index * 3 + 1]!, b.positions[index * 3 + 2]!);
  }

  /** Where an event is drawn on screen, in CSS pixels, or null when it is
   *  behind the planet, behind the camera or off screen. */
  screenPositionOf(index: number): { x: number; y: number } | null {
    const b = this.buffers;
    if (b === null || index < 0 || index >= b.count) return null;
    const true3 = new THREE.Vector3(b.positions[index * 3]!, b.positions[index * 3 + 1]!, b.positions[index * 3 + 2]!);
    const x = this.displayMaterial.uniforms.uXray!.value as number;
    const v = true3.clone().normalize().multiplyScalar(EPICENTRE_LIFT).lerp(true3, x);
    this.camera.updateMatrixWorld();
    if (x < 0.5 && v.dot(this.camera.position) < 1) return null; // beyond the horizon
    v.project(this.camera);
    if (v.z < -1 || v.z > 1) return null;
    const { width, height } = this.cssSize();
    const sx = ((v.x + 1) / 2) * width;
    const sy = ((1 - v.y) / 2) * height;
    if (sx < 0 || sy < 0 || sx > width || sy > height) return null;
    return { x: sx, y: sy };
  }

  private cssSize(): { width: number; height: number } {
    const dpr = this.renderer.getPixelRatio();
    return { width: this.renderer.domElement.width / dpr, height: this.renderer.domElement.height / dpr };
  }

  private rayAt(x: number, y: number): { origin: V3; dir: V3 } {
    const { width, height } = this.cssSize();
    this.camera.updateMatrixWorld();
    const ndc = new THREE.Vector3((x / width) * 2 - 1, 1 - (y / height) * 2, 0.5).unproject(this.camera);
    const o = this.camera.position;
    const d = ndc.sub(o).normalize();
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
  }

  /**
   * Where a ray meets the ground: the sea-level sphere first, then the sphere
   * through the terrain height found there, twice, which converges to within
   * metres on any real slope.
   */
  private hitGround(origin: V3, dir: V3): V3 | null {
    let hit = raySphere(origin, dir);
    if (hit === null) return null;
    for (let i = 0; i < 2; i++) {
      const ll = unprojectDirection(...hit);
      const r = 1 + this.earth.elevationAt(ll.lat, ll.lon) / 1000 / EARTH_KM;
      hit = raySphere(origin, dir, r) ?? hit;
    }
    return hit;
  }

  /** The ground point under a screen position, or null over space. */
  groundAt(x: number, y: number): { lat: number; lon: number } | null {
    const r = this.rayAt(x, y);
    const hit = this.hitGround(r.origin, r.dir);
    return hit ? unprojectDirection(...hit) : null;
  }

  /** Grab-drag: the ground under (fromX, fromY) follows the pointer to (toX, toY). */
  grab(fromX: number, fromY: number, toX: number, toY: number): void {
    this.flight = null;
    const a = this.rayAt(fromX, fromY), b = this.rayAt(toX, toY);
    const p = this.hitGround(a.origin, a.dir), q = this.hitGround(b.origin, b.dir);
    if (p && q) {
      const next = rotateBy(this.cam, p, q);
      this.spin = { dLon: ((next.lon - this.cam.lon + 540) % 360) - 180, dLat: next.lat - this.cam.lat };
      this.cam = next;
    } else {
      this.orbitBy(toX - fromX, toY - fromY);
      return;
    }
    this.applyCamera();
    this.requestRender();
  }

  /** Releases a drag: the planet keeps turning briefly, as if flicked. */
  release(): void {
    if (this.spin && Math.hypot(this.spin.dLon, this.spin.dLat) > 0.02 * (this.cam.altitude - 1)) {
      this.lastFrameTime = performance.now();
      this.requestRender();
    } else {
      this.spin = null;
    }
  }

  /** Drag without a ground point (over space): degrees per pixel scaled by range. */
  orbitBy(dxPixels: number, dyPixels: number): void {
    this.flight = null;
    this.spin = null;
    const scale = 0.25 * Math.min(1, (this.cam.altitude - 1) / 2.2);
    this.cam = clampState({ ...this.cam, lon: this.cam.lon - dxPixels * scale, lat: this.cam.lat + dyPixels * scale });
    this.applyCamera();
    this.requestRender();
  }

  /** Zoom toward a screen point (the centre when omitted): the ground under the
   *  cursor stays under the cursor. */
  zoomBy(factor: number, x?: number, y?: number): void {
    this.flight = null;
    this.spin = null;
    const before = x !== undefined && y !== undefined ? this.rayAt(x, y) : null;
    const p = before ? this.hitGround(before.origin, before.dir) : null;
    const range = (this.cam.altitude - 1) * factor;
    this.cam = clampState({ ...this.cam, altitude: 1 + range });
    this.applyCamera();
    if (p && x !== undefined && y !== undefined) {
      const after = this.rayAt(x, y);
      const q = this.hitGround(after.origin, after.dir);
      if (q) {
        this.cam = rotateBy(this.cam, p, q);
        this.applyCamera();
      }
    }
    this.requestRender();
  }

  /** Right-drag: turn the heading and tip the view. */
  turnBy(dHeading: number, dTilt: number): void {
    this.flight = null;
    this.spin = null;
    this.cam = clampState({ ...this.cam, heading: this.cam.heading + dHeading, tilt: this.cam.tilt + dTilt });
    this.applyCamera();
    this.requestRender();
  }

  /** North up and looking straight down, keeping position and range. */
  resetOrientation(): void {
    this.flyTo({ ...this.cam, heading: 0, tilt: 0 }, 600);
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

  /** Elevation under the camera's target, Earth radii; follows terrain as it loads. */
  private ground = 0;

  private applyCamera(): void {
    this.ground = this.earth.elevationAt(this.cam.lat, this.cam.lon) / 1000 / EARTH_KM;
    const pose = cameraPose(this.cam, this.ground);
    this.camera.position.set(...pose.position);
    this.camera.up.set(...pose.up);
    this.camera.lookAt(...pose.target);
    // Near and far follow the altitude: 1.5 km above the ground and a whole
    // hemisphere away cannot share one fixed depth range.
    const dist = Math.hypot(...pose.position);
    // Height above the GROUND below, not sea level: over the Himalaya a near
    // plane set from sea level would sit inside the mountain.
    const nadir = unprojectDirection(...pose.position);
    const below = this.earth.elevationAt(nadir.lat, nadir.lon) / 1000 / EARTH_KM;
    const height = Math.max(1e-6, dist - 1 - below);
    const horizon = Math.sqrt(Math.max(0, dist * dist - 1));
    this.camera.near = Math.max(2e-6, height * 0.25);
    this.camera.far = horizon + (this.xray.target > 0 || this.xray.value > 0 ? 2.2 : 0.3) + 0.05;
    this.camera.updateProjectionMatrix();
    this.earth.setRange(height);
    this.starCamera.quaternion.copy(this.camera.quaternion);
    // The atmosphere is seen from outside; from inside it would tint the whole sky.
    this.atmosphere.material.uniforms.uStrength!.value = Math.min(1, Math.max(0, (dist - 1.03) / 0.25));
    // Only real moves are news: re-seating on refined terrain changes the pose,
    // not the view state, and each notification rewrites the page URL.
    const c = this.cam, l = this.lastNotified;
    if (l === null || c.lon !== l.lon || c.lat !== l.lat || c.altitude !== l.altitude || c.heading !== l.heading || c.tilt !== l.tilt) {
      this.lastNotified = { ...c };
      this.opts.onCameraChange?.(this.cam);
    }
  }

  private lastNotified: CameraState | null = null;

  /** Advances fly-to, inertia and x-ray; true while any of them needs another frame. */
  private animate(now: number): boolean {
    let busy = false;
    const dt = Math.min(0.05, Math.max(0, (now - (this.lastFrameTime || now)) / 1000));
    this.lastFrameTime = now;
    if (this.flight) {
      const u = Math.min(1, (now - this.flight.start) / this.flight.ms);
      this.cam = flyPath(this.flight.from, this.flight.to, u);
      if (u >= 1) this.flight = null;
      this.applyCamera();
      busy = true;
    } else if (this.spin) {
      const decay = Math.exp(-dt * 4.5);
      this.spin = { dLon: this.spin.dLon * decay, dLat: this.spin.dLat * decay };
      this.cam = clampState({ ...this.cam, lon: this.cam.lon + this.spin.dLon, lat: this.cam.lat + this.spin.dLat });
      this.applyCamera();
      if (Math.hypot(this.spin.dLon, this.spin.dLat) < 1e-4 * Math.max(0.01, this.cam.altitude - 1)) this.spin = null;
      busy = this.spin !== null;
    }
    if (this.xray.value !== this.xray.target) {
      const step = dt / XRAY_SECONDS;
      this.xray.value = this.xray.target > this.xray.value ? Math.min(this.xray.target, this.xray.value + step) : Math.max(this.xray.target, this.xray.value - step);
      this.applyXray();
      this.applyCamera();
      busy = true;
    }
    return busy;
  }

  private frame(): void {
    this.frameHandle = null;
    if (this.disposed) return;
    const t0 = performance.now();
    const animating = this.animate(t0);
    this.stats.animating = animating;
    // Heights arrive after the camera settles: re-seat it on the refined ground.
    if (Math.abs(this.earth.elevationAt(this.cam.lat, this.cam.lon) / 1000 / EARTH_KM - this.ground) > 1e-7) this.applyCamera();

    this.earth.update(this.camera, this.viewportHeight);
    this.stats.tilesDrawn = this.earth.stats.drawn;
    this.stats.tilesPending = this.earth.pending;
    this.stats.tileLevel = this.earth.stats.maxLevel;

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
    this.renderer.clear();
    this.renderer.render(this.starScene, this.starCamera);
    this.renderer.clearDepth();
    if (this.mechanisms) {
      this.camera.updateMatrixWorld();
      (this.mechanisms.material.uniforms.uViewInv!.value as THREE.Matrix3).setFromMatrix4(this.camera.matrixWorld);
    }
    this.renderer.render(this.scene, this.camera);
    this.stats.renders++;
    this.stats.frames++;
    this.stats.lastFrameMs = performance.now() - t0;
    if (animating) this.requestRender();
    else this.lastFrameTime = 0;
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
    // The ground stays in the pick pass, drawn black, so it occludes events on
    // the far side exactly as it does on screen. Everything else is hidden.
    const candidates: (THREE.Object3D | null | undefined)[] = [this.atmosphere.mesh, this.graticule, this.wave?.mesh, this.stationLayer?.points, this.slabs, this.mechanisms?.points];
    const hidden = candidates.filter((o): o is THREE.Object3D => o != null && o.visible);
    for (const o of hidden) o.visible = false;
    const groundOpaque = this.xray.value === 0;
    if (!groundOpaque) this.earth.group.visible = false;
    else this.earth.setPickMode(true);
    points.material = this.pickMaterial;
    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    this.renderer.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, this.pickPixel);
    this.renderer.setRenderTarget(null);
    for (const o of hidden) o.visible = true;
    this.earth.group.visible = true;
    this.earth.setPickMode(false);
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
    this.points.renderOrder = 2;
    this.scene.add(this.points);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.starCamera.aspect = this.camera.aspect;
    this.starCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.viewportHeight = Math.max(1, height);
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
    this.earth.dispose();
    this.atmosphere.mesh.geometry.dispose();
    this.atmosphere.material.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.pickTarget.dispose();
    this.displayMaterial.dispose();
    this.pickMaterial.dispose();
    this.graticule.geometry.dispose();
    (this.graticule.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
