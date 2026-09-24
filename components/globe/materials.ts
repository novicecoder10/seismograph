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
    },
    vertexShader: `precision highp float;
      uniform mat4 modelViewMatrix, projectionMatrix;
      uniform float uNow, uFadeSeconds, uPointScale;
      in vec3 position; in float aMag; in float aDepth; in float aTime;
      out float vDepth; out float vMag; out float vAge;
      void main() {
        vDepth = aDepth;
        vMag = aMag;
        // Age in [0,1] over uFadeSeconds. Negative means the event has not
        // happened yet at the current t, and the fragment shader discards it.
        vAge = (uNow - aTime) / uFadeSeconds;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(2.5, (1.0 + (aMag - 4.5) * 1.2) * (2.0 / -mv.z) * uPointScale);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `precision highp float;
      in float vDepth; in float vMag; in float vAge;
      out vec4 fragColor;
      void main() {
        if (vAge < 0.0) discard;              // not yet occurred at t
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        float depthT = clamp(vDepth / 700.0, 0.0, 1.0);
        vec3 col = mix(vec3(1.0, 0.36, 0.28), vec3(0.36, 0.62, 1.0), depthT);
        // Recent events burn brighter; older ones settle to a floor rather than
        // vanishing, so the catalogue stays readable.
        float recency = 1.0 - clamp(vAge, 0.0, 1.0);
        // A hard core with a short halo, rather than a broad gaussian: additive
        // blending turns wide falloffs into haze wherever seismicity clusters.
        float core = smoothstep(0.25, 0.06, r2);
        float halo = smoothstep(0.25, 0.16, r2) * 0.35;
        // Older events settle to a legible floor rather than fading out: the
        // catalogue must stay readable, with recency as emphasis, not as a
        // visibility gate.
        fragColor = vec4(col + recency * 0.45, (core + halo) * (0.72 + 0.28 * recency));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function makePickMaterial(): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uNow: { value: 0 },
      uPointScale: { value: 8.0 },
    },
    vertexShader: `precision highp float;
      uniform mat4 modelViewMatrix, projectionMatrix;
      uniform float uNow, uPointScale;
      in vec3 position; in float aMag; in float aTime; in vec3 aId;
      out vec3 vId; out float vVisible;
      void main() {
        vId = aId;
        vVisible = uNow >= aTime ? 1.0 : 0.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // A minimum of 4px: a point too small to see is still worth hovering,
        // and a 1px target is unhittable.
        gl_PointSize = max(7.0, (1.0 + (aMag - 4.5) * 1.2) * (2.0 / -mv.z) * uPointScale);
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
  });
}

export function makeShellMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x1b2a3a,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    // Off, so hypocenters inside the shell remain visible through it — the whole
    // point of true-depth rendering.
    depthWrite: false,
  });
}
