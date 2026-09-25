import * as THREE from "three";
import { projectHypocenter } from "@/lib/geo/project";
import type { Mechanism } from "@/lib/structure/mechanism";
import { toShaderTime } from "./hypocenters";

/**
 * Focal mechanisms as true 3D beachballs. Each is a point sprite shaded as a
 * sphere: the fragment's sphere normal is rotated from view space into world
 * space and then into the event's local (up, south, east) frame, and the moment
 * tensor's radiation pattern nᵀMn decides whether that direction is
 * compressional (filled, in the depth colour) or dilatational (pale). Rotating
 * the globe rotates every beachball with it, as a real focal sphere would.
 */
export function makeMechanisms(ms: Mechanism[]): { points: THREE.Points; material: THREE.RawShaderMaterial } {
  const n = ms.length;
  const pos = new Float32Array(n * 3), m0 = new Float32Array(n * 3), m1 = new Float32Array(n * 3);
  const ll = new Float32Array(n * 2), mw = new Float32Array(n), depth = new Float32Array(n), time = new Float32Array(n);
  ms.forEach((m, i) => {
    pos.set(projectHypocenter(m.lat, m.lon, m.depthKm), i * 3);
    const s = Math.max(Math.abs(m.m.rr), Math.abs(m.m.tt), Math.abs(m.m.pp), Math.abs(m.m.rt), Math.abs(m.m.rp), Math.abs(m.m.tp)) || 1;
    m0.set([m.m.rr / s, m.m.tt / s, m.m.pp / s], i * 3);
    m1.set([m.m.rt / s, m.m.rp / s, m.m.tp / s], i * 3);
    ll.set([(m.lat * Math.PI) / 180, (m.lon * Math.PI) / 180], i * 2);
    mw[i] = m.mw;
    depth[i] = m.depthKm;
    time[i] = toShaderTime(m.time);
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("aM0", new THREE.BufferAttribute(m0, 3));
  geom.setAttribute("aM1", new THREE.BufferAttribute(m1, 3));
  geom.setAttribute("aLatLon", new THREE.BufferAttribute(ll, 2));
  geom.setAttribute("aMw", new THREE.BufferAttribute(mw, 1));
  geom.setAttribute("aDepth", new THREE.BufferAttribute(depth, 1));
  geom.setAttribute("aTime", new THREE.BufferAttribute(time, 1));
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uViewInv: { value: new THREE.Matrix3() }, uNow: { value: 1e9 }, uScale: { value: 9 }, uXray: { value: 0 } },
    vertexShader: `precision highp float;
      uniform mat4 modelViewMatrix, projectionMatrix;
      uniform float uNow, uScale, uXray;
      in vec3 position; in vec3 aM0; in vec3 aM1; in vec2 aLatLon; in float aMw; in float aDepth; in float aTime;
      flat out vec3 vM0; flat out vec3 vM1; flat out vec3 vUp; flat out vec3 vSouth; flat out vec3 vEast;
      flat out float vDepth; flat out float vFuture;
      void main() {
        vM0 = aM0; vM1 = aM1; vDepth = aDepth; vFuture = aTime > uNow ? 1.0 : 0.0;
        float la = aLatLon.x, lo = aLatLon.y;
        // The local frame in scene axes (see lib/geo/project.ts: z = −cos·sin).
        vUp = vec3(cos(la) * cos(lo), sin(la), -cos(la) * sin(lo));
        vEast = vec3(-sin(lo), 0.0, -cos(lo));
        vSouth = -vec3(-sin(la) * cos(lo), cos(la), sin(la) * sin(lo));
        // On the ground at the epicentre, or at depth in x-ray (see materials.ts).
        vec3 placed = mix(normalize(position) * 1.0004, position, uXray);
        vec4 mv = modelViewMatrix * vec4(placed, 1.0);
        gl_PointSize = clamp((10.0 + max(0.0, aMw - 5.0) * 9.0) * (2.0 / -mv.z) * uScale / 9.0, 7.0, 72.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `precision highp float;
      uniform mat3 uViewInv;
      flat in vec3 vM0; flat in vec3 vM1; flat in vec3 vUp; flat in vec3 vSouth; flat in vec3 vEast;
      flat in float vDepth; flat in float vFuture;
      out vec4 fragColor;
      void main() {
        if (vFuture > 0.5) discard;
        vec2 q = (gl_PointCoord - 0.5) * 2.0;
        float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        vec3 nView = vec3(q.x, -q.y, sqrt(1.0 - r2));
        vec3 n = normalize(uViewInv * nView);
        float r = dot(n, vUp), t = dot(n, vSouth), p = dot(n, vEast);
        float pol = vM0.x * r * r + vM0.y * t * t + vM0.z * p * p + 2.0 * (vM1.x * r * t + vM1.y * r * p + vM1.z * t * p);
        float d = clamp(vDepth / 700.0, 0.0, 1.0);
        vec3 comp = mix(vec3(1.0, 0.36, 0.28), vec3(0.36, 0.62, 1.0), d);
        vec3 dil = vec3(0.91, 0.92, 0.93);
        vec3 col = pol > 0.0 ? comp : dil;
        float light = 0.45 + 0.55 * nView.z;
        float rim = smoothstep(0.82, 1.0, r2);
        fragColor = vec4(mix(col * light, vec3(0.07, 0.09, 0.1), rim * 0.7), 1.0);
      }`,
    // Drawn in the transparent pass, after the additive hypocenter glows, so a
    // mechanism is never hidden under its own event's point.
    transparent: true,
    depthWrite: true,
  });
  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  points.renderOrder = 4;
  return { points, material };
}
