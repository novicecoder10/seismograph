import * as THREE from "three";
import { projectHypocenter } from "@/lib/geo/project";

/**
 * Seismic wavefronts on the globe. Each phase's travel time over epicentral
 * distance (at the event depth) is one row of a float texture; the fragment
 * shader computes its own distance from the epicentre and glows where the
 * current time is within `width` of the phase's arrival. Shadow zones and
 * antipodal focusing need no special handling: they are in the table.
 *
 * Width: spikes/FINDINGS.md §1 found the table's null boundary quantised by up to
 * three 0.25° cells, so the glow spans at least 0.75° of distance, converted to
 * seconds through the local slowness |dt/dΔ|, or a front would show a gap at
 * every phase cutoff.
 */
export const MIN_FRONT_WIDTH_DEG = 0.75;

export interface WavefrontInput {
  lat: number;
  lon: number;
  /** One row per phase, travel time in seconds per distance sample; -1 = absent. */
  rows: Float32Array[];
  distStepDeg: number;
  /** RGB 0..1 per row. */
  colours: [number, number, number][];
}

export function makeWavefront(w: WavefrontInput): { mesh: THREE.Mesh; material: THREE.RawShaderMaterial; texture: THREE.DataTexture } {
  const nDist = w.rows[0]!.length;
  const nPhases = w.rows.length;
  const data = new Float32Array(nDist * nPhases);
  w.rows.forEach((r, i) => data.set(r, i * nDist));
  const texture = new THREE.DataTexture(data, nDist, nPhases, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  const [ex, ey, ez] = projectHypocenter(w.lat, w.lon, 0);
  const colours = new Float32Array(15);
  w.colours.slice(0, 5).forEach((c, i) => colours.set(c, i * 3));

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uTable: { value: texture },
      uEpi: { value: new THREE.Vector3(ex, ey, ez) },
      uT: { value: -1 },
      uStep: { value: w.distStepDeg },
      uNDist: { value: nDist },
      uNPhases: { value: nPhases },
      uMinWidthDeg: { value: MIN_FRONT_WIDTH_DEG },
      uColours: { value: colours },
    },
    vertexShader: `precision highp float;
      uniform mat4 modelViewMatrix, projectionMatrix;
      in vec3 position;
      out vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `precision highp float;
      precision highp sampler2D;
      uniform sampler2D uTable;
      uniform vec3 uEpi;
      uniform float uT, uStep, uNDist, uNPhases, uMinWidthDeg;
      uniform float uColours[15];
      in vec3 vDir;
      out vec4 fragColor;
      // Linear interpolation in distance; -1 when either neighbour is absent.
      float tt(int phase, float deg) {
        float f = clamp(deg / uStep, 0.0, uNDist - 1.001);
        int i0 = int(floor(f));
        float a = texelFetch(uTable, ivec2(i0, phase), 0).r;
        float b = texelFetch(uTable, ivec2(i0 + 1, phase), 0).r;
        if (a < 0.0 || b < 0.0) return -1.0;
        return mix(a, b, f - float(i0));
      }
      void main() {
        if (uT < 0.0) discard;
        float deg = degrees(acos(clamp(dot(normalize(vDir), normalize(uEpi)), -1.0, 1.0)));
        vec3 col = vec3(0.0);
        float alpha = 0.0;
        for (int p = 0; p < 5; p++) {
          if (float(p) >= uNPhases) break;
          float t = tt(p, deg);
          if (t < 0.0) continue;
          float t1 = tt(p, max(0.0, deg - uStep));
          float t2 = tt(p, min(180.0, deg + uStep));
          float slope = (t1 >= 0.0 && t2 >= 0.0) ? abs(t2 - t1) / max(1e-3, 2.0 * uStep) : 10.0;
          float width = max(2.0, uMinWidthDeg * slope);
          float d = uT - t;
          // The front, and a faint wake over ground the phase has already crossed.
          float front = 1.0 - smoothstep(0.0, width, abs(d));
          float wake = d > 0.0 ? 0.05 * exp(-d / 600.0) : 0.0;
          float g = max(front, wake);
          vec3 c = vec3(uColours[p * 3], uColours[p * 3 + 1], uColours[p * 3 + 2]);
          col += c * g;
          alpha = max(alpha, g);
        }
        if (alpha < 0.004) discard;
        fragColor = vec4(col, alpha * 0.9);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.003, 128, 96), material);
  mesh.renderOrder = 2;
  return { mesh, material, texture };
}

export interface StationMarker {
  lat: number;
  lon: number;
  hasData: boolean;
}

export function makeStations(stations: StationMarker[]): { points: THREE.Points; brightness: THREE.BufferAttribute } {
  const pos = new Float32Array(stations.length * 3);
  const has = new Float32Array(stations.length);
  stations.forEach((s, i) => {
    pos.set(projectHypocenter(s.lat, s.lon, -25), i * 3);
    has[i] = s.hasData ? 1 : 0;
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("aHas", new THREE.BufferAttribute(has, 1));
  const brightness = new THREE.BufferAttribute(new Float32Array(stations.length), 1);
  brightness.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute("aBright", brightness);
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `precision highp float;
      uniform mat4 modelViewMatrix, projectionMatrix;
      in vec3 position; in float aHas; in float aBright;
      out float vHas; out float vBright;
      void main() {
        vHas = aHas; vBright = aBright;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp((9.0 + 10.0 * clamp(aBright, 0.0, 1.0)) * (2.4 / -mv.z), 2.0, 40.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `precision highp float;
      in float vHas; in float vBright;
      out vec4 fragColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        if (r > 0.5) discard;
        // A station is a ring; recorded motion fills it. A station without data
        // stays a dim ring, so it is never mistaken for a quiet one.
        float ring = smoothstep(0.5, 0.42, r) * smoothstep(0.30, 0.38, r);
        float fill = smoothstep(0.36, 0.2, r) * vBright * vHas;
        vec3 col = mix(vec3(0.49, 0.53, 0.56), vec3(0.91, 0.92, 0.93), max(vBright * vHas, 0.0));
        fragColor = vec4(col, max(ring * (0.55 + 0.45 * vHas), fill));
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  return { points, brightness };
}
