import * as THREE from "three";

/**
 * The two materials verified by the Phase 0 spike (spikes/globe/main.ts). The
 * spike code is throwaway; these shaders are the one thing carried across,
 * because they are what the 1,000,000-points-at-60fps measurement was made with.
 *
 * Colour scale: shallow #ff5c47 to deep #5c9eff over 0..700 km, which preserves
 * the warm-to-cool reading of the original magnitude scale while encoding depth
 * — the dimension the 2D map could not show.
 */
/** Epicentre markers sit this far above the ground (≈ 250 m): above the imagery,
 *  below anything a camera 1.5 km up would clip. */
export const EPICENTRE_LIFT = 1 + 0.25 / 6371;

/**
 * Where a point is drawn. uXray = 0: at its epicentre, on the ground, where it
 * would be felt and where the imagery shows it; the ground occludes the far
 * side. uXray = 1: at its true hypocenter, seen through translucent ground.
 * In between, the points sink, which is the transition the reader watches.
 */
const PLACE = `
  vec3 placed(vec3 hypo, float xray) {
    return mix(normalize(hypo) * ${EPICENTRE_LIFT.toFixed(8)}, hypo, xray);
  }
  // Points are NOT depth-tested against the ground: a sprite has one depth,
  // and ground curving toward the camera buried half of every marker. Instead
  // an epicentre is hidden exactly when it is over the horizon: a surface
  // point p is visible from C iff p·C > 1. In x-ray everything shows.
  float hidden(vec3 hypo, vec3 cam, float xray) {
    return xray < 0.5 && dot(normalize(hypo), cam) < 1.0 ? 1.0 : 0.0;
  }`;

export function makeDisplayMaterial(): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uNow: { value: 0 },
      uFadeSeconds: { value: 3600 },
      // Tuned by looking at it. The spike used 40, which was never validated
      // visually — only for frame rate — and produces 65-pixel blobs on a sparse
      // catalogue.
      uPointScale: { value: 8.0 },
      uXray: { value: 0 },
    },
    vertexShader: `precision highp float;
      uniform mat4 modelViewMatrix, projectionMatrix;
      uniform vec3 cameraPosition;
      uniform float uNow, uFadeSeconds, uPointScale, uXray;
      in vec3 position; in float aMag; in float aDepth; in float aTime;
      out float vDepth; out float vMag; out float vAge; out float vHidden;
      ${PLACE}
      void main() {
        vDepth = aDepth;
        vMag = aMag;
        // Age in [0,1] over uFadeSeconds. Negative means the event has not
        // happened yet at the current t, and the fragment shader discards it.
        vAge = (uNow - aTime) / uFadeSeconds;
        vHidden = hidden(position, cameraPosition, uXray);
        vec4 mv = modelViewMatrix * vec4(placed(position, uXray), 1.0);
        // Grows as the camera closes in, up to a cap: at 2 km altitude the
        // uncapped size would be thousands of pixels.
        float size = (1.0 + (aMag - 4.5) * 1.2) * (2.0 / -mv.z) * uPointScale;
        gl_PointSize = clamp(size, 3.0, 14.0 + (aMag - 4.5) * 9.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `precision highp float;
      in float vDepth; in float vMag; in float vAge; in float vHidden;
      out vec4 fragColor;
      void main() {
        if (vAge < 0.0 || vHidden > 0.5) discard;  // not yet occurred at t, or over the horizon
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        float depthT = clamp(vDepth / 700.0, 0.0, 1.0);
        vec3 col = mix(vec3(1.0, 0.36, 0.28), vec3(0.36, 0.62, 1.0), depthT);
        // Recent events burn brighter; older ones settle to a legible floor
        // rather than vanishing: recency is emphasis, not a visibility gate.
        float recency = 1.0 - clamp(vAge, 0.0, 1.0);
        // Over satellite imagery an additive glow washes out on bright ground,
        // so each marker is a solid disc with a dark rim, readable on snow,
        // desert and ocean alike.
        float disc = smoothstep(0.25, 0.20, r2);
        float rim = smoothstep(0.13, 0.17, r2);
        vec3 c = mix(col + recency * 0.3, vec3(0.04, 0.05, 0.06), rim * 0.85);
        fragColor = vec4(c, disc * (0.82 + 0.18 * recency));
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
}

export function makePickMaterial(): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uNow: { value: 0 },
      uPointScale: { value: 8.0 },
      uXray: { value: 0 },
    },
    vertexShader: `precision highp float;
      uniform mat4 modelViewMatrix, projectionMatrix;
      uniform vec3 cameraPosition;
      uniform float uNow, uPointScale, uXray;
      in vec3 position; in float aMag; in float aTime; in vec3 aId;
      out vec3 vId; out float vVisible;
      ${PLACE}
      void main() {
        vId = aId;
        vVisible = uNow >= aTime && hidden(position, cameraPosition, uXray) < 0.5 ? 1.0 : 0.0;
        vec4 mv = modelViewMatrix * vec4(placed(position, uXray), 1.0);
        // A minimum of 7px: a point too small to see is still worth hovering,
        // and a 1px target is unhittable.
        float size = (1.0 + (aMag - 4.5) * 1.2) * (2.0 / -mv.z) * uPointScale;
        gl_PointSize = clamp(size, 7.0, 18.0 + (aMag - 4.5) * 9.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `precision highp float;
      in vec3 vId; in float vVisible;
      out vec4 fragColor;
      void main() {
        if (vVisible < 0.5) discard;
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        fragColor = vec4(vId, 1.0);
      }`,
    depthTest: false,
  });
}
