import * as THREE from "three";
import { projectHypocenter } from "@/lib/geo/project";
import { slabMesh, type Slab } from "@/lib/structure/slab2";

/**
 * Subducting slabs as translucent surfaces at true depth, so the hypocenters
 * that trace them (Wadati-Benioff zones) are seen inside the plate they break.
 * Shaded with the hypocenters' depth ramp, darker in 100 km bands so depth can
 * be read off the surface itself.
 */
export function makeSlabs(slabs: Slab[]): THREE.Mesh {
  const positions: number[] = [];
  const depths: number[] = [];
  const indices: number[] = [];
  for (const s of slabs) {
    const m = slabMesh(s);
    const base = positions.length / 3;
    for (let k = 0; k < m.vertices.length; k += 3) {
      const [x, y, z] = projectHypocenter(m.vertices[k]!, m.vertices[k + 1]!, m.vertices[k + 2]!);
      positions.push(x, y, z);
      depths.push(m.vertices[k + 2]!);
    }
    for (const i of m.indices) indices.push(base + i);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("aDepth", new THREE.Float32BufferAttribute(depths, 1));
  geom.setIndex(indices);
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uFade: { value: 1 } },
    vertexShader: `precision highp float;
      uniform mat4 modelViewMatrix, projectionMatrix;
      in vec3 position; in float aDepth;
      out float vDepth;
      void main() {
        vDepth = aDepth;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `precision highp float;
      uniform float uFade;
      in float vDepth;
      out vec4 fragColor;
      void main() {
        float t = clamp(vDepth / 700.0, 0.0, 1.0);
        vec3 col = mix(vec3(1.0, 0.36, 0.28), vec3(0.36, 0.62, 1.0), t);
        float band = fract(vDepth / 100.0) < 0.06 ? 0.55 : 1.0;
        fragColor = vec4(col * band * 0.9, 0.28 * uFade);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}
