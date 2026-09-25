import * as THREE from "three";
import { projectHypocenter } from "@/lib/geo/project";
import { selectTiles, subRect, tileBounds, tileId, type TileKey } from "@/lib/globe/tiles";

/**
 * The planet under the catalogue: streamed satellite imagery on a quadtree of
 * sphere patches, lit by the real Sun, with city lights on the night side, an
 * optional label overlay and an atmosphere.
 *
 * Sources (free, CORS-open; see public/data/SOURCES.md and the page footer):
 *   day      EOX Sentinel-2 cloudless 2024, WMTS WGS84 grid, levels 0–17
 *   labels   EOX overlay_bright (OpenStreetMap data), same grid
 *   base     NASA GIBS Blue Marble, stitched once into a global texture: shown
 *            wherever a Sentinel tile has not arrived or failed
 *   night    NASA GIBS VIIRS Black Marble, stitched the same way
 *
 * GIBS uses a different geographic grid (288° tiles at level 0), so it cannot
 * share the quadtree; stitched into equirectangular textures it does not need to.
 */

const EOX = "https://tiles.maps.eox.at/wmts/1.0.0";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";
export const DAY_URL = (k: TileKey) => `${EOX}/s2cloudless-2024/default/WGS84/${k.z}/${k.y}/${k.x}.jpg`;
export const LABEL_URL = (k: TileKey) => `${EOX}/overlay_bright/default/WGS84/${k.z}/${k.y}/${k.x}.png`;
export const MAX_LEVEL = 16;
const LABEL_MIN_LEVEL = 2;
/** The overlay's deepest level; deeper tiles borrow a sub-rectangle of it. */
const LABEL_MAX_LEVEL = 13;
const MAX_IN_FLIGHT = 8;
const CACHE_LIMIT = 420;

export const IMAGERY_ATTRIBUTION =
  "Imagery: Sentinel-2 cloudless 2024 by EOX (CC BY-NC-SA 4.0, contains modified Copernicus Sentinel data) · Labels © OpenStreetMap contributors, EOX · Blue Marble and Black Marble: NASA";

type LoadState = "idle" | "queued" | "loading" | "ok" | "failed";

interface Layer {
  state: LoadState;
  texture: THREE.Texture | null;
  image: HTMLImageElement | null;
}

interface Tile {
  key: TileKey;
  id: string;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  day: Layer;
  label: Layer;
  lastUsed: number;
}

const emptyLayer = (): Layer => ({ state: "idle", texture: null, image: null });

function makeTileGeometry(k: TileKey): { geometry: THREE.BufferGeometry; center: THREE.Vector3 } {
  const b = tileBounds(k);
  const segs = k.z === 0 ? 48 : k.z <= 2 ? 24 : k.z <= 6 ? 16 : 8;
  const c = new THREE.Vector3(...projectHypocenter((b.north + b.south) / 2, (b.east + b.west) / 2, 0));
  const pos = new Float32Array((segs + 1) * (segs + 1) * 3);
  const uv = new Float32Array((segs + 1) * (segs + 1) * 2);
  let p = 0, q = 0;
  for (let j = 0; j <= segs; j++) {
    const lat = b.south + ((b.north - b.south) * j) / segs;
    for (let i = 0; i <= segs; i++) {
      const lon = b.west + ((b.east - b.west) * i) / segs;
      const v = projectHypocenter(lat, lon, 0);
      // Relative to the tile centre: float32 world coordinates would jitter by
      // metres at the deepest levels.
      pos[p++] = v[0] - c.x;
      pos[p++] = v[1] - c.y;
      pos[p++] = v[2] - c.z;
      uv[q++] = i / segs;
      uv[q++] = j / segs;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i, b2 = a + 1, c2 = a + segs + 1, d = c2 + 1;
      // Counter-clockwise seen from outside (east right, north up).
      index.push(a, b2, c2, b2, d, c2);
    }
  }
  // Skirts: a strip hanging down from every edge. Neighbouring tiles at
  // different levels do not share edge vertices, and the chord of a coarse edge
  // dips below a fine one, which shows as hairline cracks without them.
  const skirt = Math.max(2e-6, ((b.north - b.south) * Math.PI) / 180 / segs * 0.35);
  const ring: number[] = [];
  for (let i = 0; i <= segs; i++) ring.push(i);
  for (let j = 1; j <= segs; j++) ring.push(j * (segs + 1) + segs);
  for (let i = segs - 1; i >= 0; i--) ring.push(segs * (segs + 1) + i);
  for (let j = segs - 1; j >= 0; j--) ring.push(j * (segs + 1));
  const extra = new Float32Array(ring.length * 3), extraUv = new Float32Array(ring.length * 2);
  const base = (segs + 1) * (segs + 1);
  ring.forEach((vi, k) => {
    const x = pos[vi * 3]! + c.x, y = pos[vi * 3 + 1]! + c.y, z = pos[vi * 3 + 2]! + c.z;
    extra[k * 3] = x * (1 - skirt) - c.x;
    extra[k * 3 + 1] = y * (1 - skirt) - c.y;
    extra[k * 3 + 2] = z * (1 - skirt) - c.z;
    extraUv[k * 2] = uv[vi * 2]!;
    extraUv[k * 2 + 1] = uv[vi * 2 + 1]!;
    const next = (k + 1) % ring.length;
    index.push(vi, base + k, ring[next]!, ring[next]!, base + k, base + next);
  });
  const allPos = new Float32Array(pos.length + extra.length);
  allPos.set(pos);
  allPos.set(extra, pos.length);
  const allUv = new Float32Array(uv.length + extraUv.length);
  allUv.set(uv);
  allUv.set(extraUv, uv.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(allPos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(allUv, 2));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), c.distanceTo(new THREE.Vector3(...projectHypocenter(b.north, b.west, 0))) * 1.05);
  return { geometry: g, center: c };
}

/** Uniforms shared by every tile: one object, referenced by all materials. */
export interface EarthUniforms {
  uBase: { value: THREE.Texture };
  uNight: { value: THREE.Texture };
  uSun: { value: THREE.Vector3 };
  uSunlight: { value: number };
  uLabels: { value: number };
  uOpacity: { value: number };
  uPick: { value: number };
  /** 1 from orbit, 0 close to the ground: night fades out as you descend. */
  uNightMix: { value: number };
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uTex, uLabel, uBase, uNight;
  uniform vec2 uTexOffset, uLabelOffset;
  uniform float uTexScale, uLabelScale, uHasTex, uHasLabel;
  uniform vec3 uSun;
  uniform float uSunlight, uLabels, uOpacity, uPick, uNightMix;
  varying vec2 vUv;
  varying vec3 vWorld;
  const float PI = 3.141592653589793;
  void main() {
    // The pick pass draws the ground black: it occludes, and decodes as nothing.
    if (uPick > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec3 n = normalize(vWorld);
    // Scene axes: lon = atan(−z, x) (see lib/geo/project.ts).
    vec2 g = vec2(atan(-n.z, n.x) / (2.0 * PI) + 0.5, asin(clamp(n.y, -1.0, 1.0)) / PI + 0.5);
    vec3 day = uHasTex > 0.5 ? texture(uTex, uTexOffset + vUv * uTexScale).rgb : texture(uBase, g).rgb;

    float light = 1.0;
    vec3 night = vec3(0.0);
    if (uSunlight > 0.5 && uNightMix > 0.0) {
      float d = dot(n, uSun);
      float dayF = smoothstep(-0.10, 0.22, d);
      // A floor, not black: the night side must stay readable. Close to the
      // ground night fades out entirely, as in Google Earth: the lights texture
      // is 14 km a pixel and the ground is what the reader came to see.
      light = mix(1.0, mix(0.46, 1.08, dayF), uNightMix);
      night = texture(uNight, g).rgb * (1.0 - dayF);
      night = night * night * 1.5 * uNightMix;
    }
    vec3 col = day * light + night * vec3(1.0, 0.86, 0.62);

    // Aerial perspective: blue haze toward the limb.
    vec3 v = normalize(cameraPosition - vWorld);
    float limb = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
    col = mix(col, vec3(0.38, 0.62, 1.0) * max(light, 0.45), limb * 0.55);

    if (uHasLabel > 0.5 && uLabels > 0.5) {
      vec4 lab = texture(uLabel, uLabelOffset + vUv * uLabelScale);
      // The overlay draws maritime-zone boundaries in orange at low zoom: noise
      // at this scale. Text is white on a dark halo, so orange pixels are dropped.
      float orange = smoothstep(0.18, 0.32, lab.r - lab.b);
      col = mix(col, lab.rgb * max(light, 0.8), lab.a * 0.92 * (1.0 - orange));
    }
    gl_FragColor = vec4(col, uOpacity);
  }`;

export class EarthLayer {
  readonly group = new THREE.Group();
  readonly uniforms: EarthUniforms;
  readonly stats = { drawn: 0, cached: 0, inFlight: 0, queued: 0, failed: 0, maxLevel: 0 };
  private readonly tiles = new Map<string, Tile>();
  private queue: { tile: Tile; layer: "day" | "label"; priority: number }[] = [];
  private inFlight = 0;
  private frame = 0;
  private labelsOn = true;
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private disposed = false;

  constructor(private readonly onChange: () => void) {
    const placeholder = new THREE.DataTexture(new Uint8Array([10, 22, 38, 255]), 1, 1);
    placeholder.needsUpdate = true;
    const dark = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    dark.needsUpdate = true;
    this.uniforms = {
      uBase: { value: placeholder },
      uNight: { value: dark },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uSunlight: { value: 1 },
      uLabels: { value: 1 },
      uOpacity: { value: 1 },
      uPick: { value: 0 },
      uNightMix: { value: 1 },
    };
    void this.stitch("BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/500m", "jpeg", 1).then((t) => {
      if (t) { this.uniforms.uBase.value = t; this.onChange(); }
    });
    void this.stitch("VIIRS_Black_Marble/default/2016-01-01/500m", "png", 2).then((t) => {
      if (t) { this.uniforms.uNight.value = t; this.onChange(); }
    });
  }

  /** Builds an equirectangular texture from one GIBS level (288°/2^z tiles of 512 px). */
  private async stitch(layer: string, ext: string, level: number): Promise<THREE.Texture | null> {
    const span = 288 / 2 ** level;
    const cols = Math.ceil(360 / span), rows = Math.ceil(180 / span);
    const pxPerDeg = 512 / span;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(360 * pxPerDeg);
    canvas.height = Math.round(180 * pxPerDeg);
    const ctx = canvas.getContext("2d");
    if (ctx === null) return null;
    const jobs: Promise<void>[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        jobs.push(
          loadImage(`${GIBS}/${layer}/${level}/${y}/${x}.${ext}`).then(
            (img) => ctx.drawImage(img, x * 512, y * 512),
            () => undefined,
          ),
        );
      }
    }
    await Promise.all(jobs);
    if (this.disposed) return null;
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 4;
    return t;
  }

  setLabels(on: boolean): void {
    this.labelsOn = on;
    this.uniforms.uLabels.value = on ? 1 : 0;
  }

  setSunlight(on: boolean, direction: [number, number, number]): void {
    this.uniforms.uSunlight.value = on ? 1 : 0;
    this.uniforms.uSun.value.set(...direction);
  }

  /** Range above the ground, in Earth radii: night shows from orbit only. */
  setRange(range: number): void {
    this.uniforms.uNightMix.value = Math.min(1, Math.max(0, (range - 0.02) / (0.15 - 0.02)));
  }

  setOpacity(opacity: number): void {
    this.uniforms.uOpacity.value = opacity;
    const translucent = opacity < 0.999;
    for (const t of this.tiles.values()) {
      t.material.transparent = translucent;
      t.material.depthWrite = !translucent;
    }
  }

  /** Black, opaque ground for the pick pass. */
  setPickMode(on: boolean): void {
    this.uniforms.uPick.value = on ? 1 : 0;
  }

  get pending(): number {
    return this.inFlight + this.queue.length;
  }

  /** Chooses the tiles for this view, shows them, and schedules what is missing. */
  update(camera: THREE.PerspectiveCamera, viewportHeightPx: number): void {
    this.frame++;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const sphere = new THREE.Sphere();
    const selected = selectTiles({
      camera: [camera.position.x, camera.position.y, camera.position.z],
      fovY: (camera.fov * Math.PI) / 180,
      viewportHeightPx,
      maxLevel: MAX_LEVEL,
      inFrustum: (c, r) => this.frustum.intersectsSphere(sphere.set(new THREE.Vector3(...c), r)),
    });

    for (const t of this.tiles.values()) t.mesh.visible = false;
    this.queue = [];
    let maxLevel = 0;
    selected.forEach(({ key }, rank) => {
      const tile = this.ensure(key);
      tile.mesh.visible = true;
      tile.lastUsed = this.frame;
      maxLevel = Math.max(maxLevel, key.z);
      this.bind(tile, "day");
      if (this.labelsOn && key.z >= LABEL_MIN_LEVEL) this.bind(tile, "label");
      else tile.material.uniforms.uHasLabel!.value = 0;
      // Coarse levels first so the whole view fills in quickly, then near to far.
      if (tile.day.state === "idle" || tile.day.state === "queued") this.queue.push({ tile, layer: "day", priority: key.z <= 3 ? -100 + key.z : rank });
      if (this.labelsOn && key.z >= LABEL_MIN_LEVEL) {
        const s = Math.max(0, key.z - LABEL_MAX_LEVEL);
        const src = s === 0 ? tile : this.ensure({ z: LABEL_MAX_LEVEL, x: key.x >> s, y: key.y >> s });
        src.lastUsed = this.frame;
        if (src.label.state === "idle" || src.label.state === "queued") this.queue.push({ tile: src, layer: "label", priority: rank + 0.5 });
      }
      // The ancestors a missing tile will borrow from must load too.
      for (let a = key.z - 1; a >= 0 && a >= key.z - 4; a--) {
        const s = key.z - a;
        const anc = this.ensure({ z: a, x: key.x >> s, y: key.y >> s });
        anc.lastUsed = this.frame;
        if (anc.day.state === "idle" || anc.day.state === "queued") this.queue.push({ tile: anc, layer: "day", priority: -200 + a });
      }
    });
    for (const q of this.queue) q.tile[q.layer].state = "queued";
    this.queue.sort((a, b) => a.priority - b.priority);
    this.stats.drawn = selected.length;
    this.stats.maxLevel = maxLevel;
    this.pump();
    this.evict();
    this.stats.cached = this.tiles.size;
    this.stats.queued = this.queue.length;
  }

  private ensure(key: TileKey): Tile {
    const id = tileId(key);
    let t = this.tiles.get(id);
    if (t) return t;
    const { geometry, center } = makeTileGeometry(key);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...this.uniforms,
        uTex: { value: null },
        uTexOffset: { value: new THREE.Vector2() },
        uTexScale: { value: 1 },
        uHasTex: { value: 0 },
        uLabel: { value: null },
        uLabelOffset: { value: new THREE.Vector2() },
        uLabelScale: { value: 1 },
        uHasLabel: { value: 0 },
      },
      transparent: this.uniforms.uOpacity.value < 0.999,
      depthWrite: this.uniforms.uOpacity.value >= 0.999,
      // Skirts face either way; tiles beyond the horizon are never drawn.
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);
    mesh.renderOrder = -1;
    mesh.visible = false;
    this.group.add(mesh);
    t = { key, id, mesh, material, day: emptyLayer(), label: emptyLayer(), lastUsed: this.frame };
    this.tiles.set(id, t);
    return t;
  }

  /** Points a tile at its own texture, or the nearest loaded ancestor's. */
  private bind(tile: Tile, layer: "day" | "label"): void {
    const u = tile.material.uniforms;
    const [tex, off, sc, has] = layer === "day" ? ["uTex", "uTexOffset", "uTexScale", "uHasTex"] : ["uLabel", "uLabelOffset", "uLabelScale", "uHasLabel"];
    let src: Tile | null = null;
    for (let a = tile.key.z; a >= 0; a--) {
      const s = tile.key.z - a;
      const cand = a === tile.key.z ? tile : this.tiles.get(tileId({ z: a, x: tile.key.x >> s, y: tile.key.y >> s }));
      if (cand && cand[layer].state === "ok") { src = cand; break; }
      if (layer === "label" && a <= LABEL_MIN_LEVEL) break;
    }
    if (src === null) { u[has]!.value = 0; return; }
    src.lastUsed = this.frame;
    const r = subRect(tile.key, src.key);
    u[tex]!.value = src[layer].texture;
    (u[off]!.value as THREE.Vector2).set(...r.offset);
    u[sc]!.value = r.scale;
    u[has]!.value = 1;
  }

  private pump(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const { tile, layer } = this.queue.shift()!;
      const L = tile[layer];
      if (L.state !== "queued") continue;
      L.state = "loading";
      this.inFlight++;
      const url = layer === "day" ? DAY_URL(tile.key) : LABEL_URL(tile.key);
      const img = new Image();
      L.image = img;
      loadImage(url, img).then(
        () => {
          if (this.disposed) return;
          const t = new THREE.Texture(img);
                t.anisotropy = 4;
          t.needsUpdate = true;
          L.texture = t;
          L.state = "ok";
        },
        () => {
          L.state = "failed";
          this.stats.failed++;
        },
      ).finally(() => {
        L.image = null;
        this.inFlight--;
        this.stats.inFlight = this.inFlight;
        if (!this.disposed) this.onChange();
      });
    }
    this.stats.inFlight = this.inFlight;
  }

  private evict(): void {
    if (this.tiles.size <= CACHE_LIMIT) return;
    const old = [...this.tiles.values()]
      .filter((t) => t.lastUsed < this.frame && t.day.state !== "loading" && t.label.state !== "loading" && t.key.z > 1)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const t of old.slice(0, this.tiles.size - CACHE_LIMIT)) this.drop(t);
  }

  private drop(t: Tile): void {
    t.day.texture?.dispose();
    t.label.texture?.dispose();
    t.mesh.geometry.dispose();
    t.material.dispose();
    this.group.remove(t.mesh);
    this.tiles.delete(t.id);
  }

  dispose(): void {
    this.disposed = true;
    for (const t of [...this.tiles.values()]) this.drop(t);
    this.uniforms.uBase.value.dispose();
    this.uniforms.uNight.value.dispose();
  }
}

function loadImage(url: string, img: HTMLImageElement = new Image()): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed: ${url}`));
    img.src = url;
  });
}

/** A soft blue limb: the atmosphere seen edge-on. */
export function makeAtmosphere(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const material = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 1 }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uSunlight: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vN = normalize(w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength, uSunlight; uniform vec3 uSun;
      varying vec3 vN; varying vec3 vWorld;
      void main() {
        vec3 v = normalize(cameraPosition - vWorld);
        float rim = pow(clamp(1.0 + dot(v, vN) * 1.0, 0.0, 1.0), 3.0);
        float lit = uSunlight > 0.5 ? mix(0.25, 1.0, smoothstep(-0.25, 0.3, dot(vN, uSun))) : 1.0;
        gl_FragColor = vec4(vec3(0.32, 0.58, 1.0) * rim * lit * uStrength, 1.0);
      }`,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.028, 96, 64), material);
  mesh.renderOrder = -2;
  return { mesh, material };
}

/** A fixed-seed star field, drawn in its own pass so it never fights the depth range. */
export function makeStars(): THREE.Points {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = 5000;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), tint = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([50 * s * Math.cos(th), 50 * u, 50 * s * Math.sin(th)], i * 3);
    size[i] = 0.6 + rand() ** 6 * 2.6;
    tint[i] = rand();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  g.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uPixelRatio;
      attribute float aSize; attribute float aTint; varying float vTint; varying float vSize;
      void main() {
        vTint = aTint; vSize = aSize;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vTint; varying float vSize;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.25, 0.0, dot(d, d)) * clamp(vSize / 2.2, 0.35, 1.0);
        vec3 c = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.92, 0.8), vTint);
        gl_FragColor = vec4(c, a * 0.9);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}
