// Throwaway spike: can three.js render 100k hypocenters at true depth at 60fps,
// inside a translucent Earth, with GPU picking?
import * as THREE from "three";

const R = 1.0; // Earth radius in scene units
const EARTH_RADIUS_KM = 6371;
// Overridable so the spike can measure a scaling curve: /?points=25000
const POINT_COUNT = (() => {
  const q = Number(new URLSearchParams(location.search).get("points"));
  return Number.isFinite(q) && q > 0 ? Math.floor(q) : 100_000;
})();

declare global {
  interface Window {
    __spike: {
      fps: number;
      pointCount: number;
      pickedId: number | null;
      pickMs: number;
      frameMs: number;
      pickMode: string;
      renderer: string;
      webglOk: boolean;
      error: string | null;
    };
  }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

window.__spike = {
  fps: 0, pointCount: 0, pickedId: null, pickMs: 0, frameMs: 0,
  renderer: "", webglOk: false, error: null,
};
const hud = document.getElementById("hud")!;

if (!webglAvailable()) {
  window.__spike.error = "WebGL unavailable";
  hud.textContent = "WebGL unavailable — production must fall back to 2D canvas";
} else {
  window.__spike.webglOk = true;
  main();
}

function main() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 100);
  camera.position.set(0, 0, 3.2);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const dbg = renderer.getContext().getExtension("WEBGL_debug_renderer_info");
  window.__spike.renderer = dbg
    ? String(renderer.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL))
    : "unknown";
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  // Translucent Earth. depthWrite off so hypocenters inside remain visible.
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(R, 64, 48),
    new THREE.MeshBasicMaterial({
      color: 0x1b2a3a, transparent: true, opacity: 0.18,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  scene.add(shell);

  const positions = new Float32Array(POINT_COUNT * 3);
  const mags = new Float32Array(POINT_COUNT);
  const depths = new Float32Array(POINT_COUNT);
  const ids = new Float32Array(POINT_COUNT * 3); // ID as RGB for the picking pass

  let seed = 20260923;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  for (let i = 0; i < POINT_COUNT; i++) {
    const lat = ((rand() * 180 - 90) * Math.PI) / 180;
    const lon = ((rand() * 360 - 180) * Math.PI) / 180;
    const depthKm = rand() < 0.85 ? rand() * 70 : 70 + rand() * 630;
    const r = R * (1 - depthKm / EARTH_RADIUS_KM);
    positions[i * 3 + 0] = r * Math.cos(lat) * Math.cos(lon);
    positions[i * 3 + 1] = r * Math.sin(lat);
    positions[i * 3 + 2] = r * Math.cos(lat) * Math.sin(lon);
    mags[i] = 4.5 + rand() * 4;
    depths[i] = depthKm;
    const id = i + 1; // 0 reserved for "nothing"
    ids[i * 3 + 0] = ((id >> 16) & 255) / 255;
    ids[i * 3 + 1] = ((id >> 8) & 255) / 255;
    ids[i * 3 + 2] = (id & 255) / 255;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("aMag", new THREE.BufferAttribute(mags, 1));
  geom.setAttribute("aDepth", new THREE.BufferAttribute(depths, 1));
  geom.setAttribute("aId", new THREE.BufferAttribute(ids, 3));

  const displayMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `precision highp float;
      uniform mat4 modelViewMatrix, projectionMatrix;
      in vec3 position; in float aMag; in float aDepth; in vec3 aId;
      out float vDepth; out float vMag;
      void main() {
        vDepth = aDepth; vMag = aMag;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.5, (1.0 + (aMag - 4.5) * 1.6) * (2.0 / -mv.z) * 40.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `precision highp float;
      in float vDepth; in float vMag;
      out vec4 fragColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        float t = clamp(vDepth / 700.0, 0.0, 1.0);
        vec3 col = mix(vec3(1.0, 0.36, 0.28), vec3(0.36, 0.62, 1.0), t);
        fragColor = vec4(col, smoothstep(0.25, 0.02, r2));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const pickMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `precision highp float;
      uniform mat4 modelViewMatrix, projectionMatrix;
      in vec3 position; in float aMag; in vec3 aId;
      out vec3 vId;
      void main() {
        vId = aId;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(4.0, (1.0 + (aMag - 4.5) * 1.6) * (2.0 / -mv.z) * 40.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `precision highp float;
      in vec3 vId; out vec4 fragColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        fragColor = vec4(vId, 1.0);
      }`,
  });

  const points = new THREE.Points(geom, displayMat);
  scene.add(points);
  window.__spike.pointCount = POINT_COUNT;

  // GPU picking: render IDs into a 1x1 target through a view offset under the cursor.
  const pickTarget = new THREE.WebGLRenderTarget(1, 1);
  const pickPixel = new Uint8Array(4);

  // Sync readback stalls the pipeline: the GPU must drain every queued frame
  // before readPixels returns, so its cost grows with scene size even though the
  // pick pass itself renders one pixel. Measured 8.6 s at 100k points. The async
  // path uses a fence instead and is the whole reason this spike exists.
  const PICK_MODE = (new URLSearchParams(location.search).get("pick") ?? "async") as
    | "sync"
    | "async";

  function renderPickPass(x: number, y: number) {
    const dpr = renderer.getPixelRatio();
    const cam = camera.clone();
    cam.setViewOffset(
      renderer.domElement.width, renderer.domElement.height,
      Math.floor(x * dpr), Math.floor(y * dpr), 1, 1,
    );
    points.material = pickMat;
    shell.visible = false;
    renderer.setRenderTarget(pickTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, cam);
  }

  function finishPick(): number | null {
    renderer.setRenderTarget(null);
    shell.visible = true;
    points.material = displayMat;
    const id =
      ((pickPixel[0] as number) << 16) |
      ((pickPixel[1] as number) << 8) |
      (pickPixel[2] as number);
    return id === 0 ? null : id - 1;
  }

  function pickSync(x: number, y: number): number | null {
    const t0 = performance.now();
    renderPickPass(x, y);
    renderer.readRenderTargetPixels(pickTarget, 0, 0, 1, 1, pickPixel);
    const out = finishPick();
    window.__spike.pickMs = performance.now() - t0;
    return out;
  }

  async function pickAsync(x: number, y: number): Promise<number | null> {
    const t0 = performance.now();
    renderPickPass(x, y);
    await renderer.readRenderTargetPixelsAsync(pickTarget, 0, 0, 1, 1, pickPixel);
    const out = finishPick();
    window.__spike.pickMs = performance.now() - t0;
    return out;
  }

  // One pick in flight at a time. Without this, a fast pointer sweep queues a
  // pick per move event and they serialise behind each other.
  window.__spike.pickMode = PICK_MODE;
  let picking = false;
  addEventListener("pointermove", (e) => {
    if (PICK_MODE === "sync") {
      window.__spike.pickedId = pickSync(e.clientX, e.clientY);
      return;
    }
    if (picking) return;
    picking = true;
    void pickAsync(e.clientX, e.clientY).then((id) => {
      window.__spike.pickedId = id;
      picking = false;
    });
  });

  // Report after either 5 frames or 1 second, whichever comes first. A fixed
  // 1-second window is unusable on a software renderer, where a single frame at
  // 100k points can take longer than that.
  const FRAME_WINDOW = 5;
  // ?loop=off freezes the render loop after the first frame, to separate the cost
  // of the pick pass itself from contention with a 60fps render loop.
  const LOOP_ON = new URLSearchParams(location.search).get("loop") !== "off";
  let frames = 0;
  let last = performance.now();
  function loop(now: number) {
    points.rotation.y += 0.0035;
    shell.rotation.y = points.rotation.y;
    renderer.render(scene, camera);
    frames++;
    if (frames >= FRAME_WINDOW || now - last >= 1000) {
      window.__spike.fps = (frames * 1000) / (now - last);
      window.__spike.frameMs = (now - last) / frames;
      hud.textContent =
        `${POINT_COUNT.toLocaleString()} pts · ${window.__spike.fps.toFixed(1)} fps · ` +
        `${window.__spike.frameMs.toFixed(1)} ms/frame · ` +
        `pick ${window.__spike.pickMs.toFixed(1)}ms · id ${window.__spike.pickedId ?? "—"}`;
      frames = 0;
      last = now;
    }
    if (LOOP_ON || frames === 0) requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // With the loop off, nothing else reports a frame time; report the one frame.
  if (!LOOP_ON) {
    const t0 = performance.now();
    renderer.render(scene, camera);
    window.__spike.frameMs = performance.now() - t0;
    window.__spike.fps = 1000 / window.__spike.frameMs;
  }

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}
