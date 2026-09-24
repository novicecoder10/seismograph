import * as THREE from "three";
import { projectHypocenter } from "@/lib/geo/project";

/**
 * A 30-degree graticule drawn just outside the shell. Without it the globe reads
 * as an abstract disc: there is no coastline in Phase 1, so the grid is the only
 * cue for where on Earth a cluster sits. Plate boundaries replace it as the
 * primary reference once they land.
 */
export function makeGraticule(radiusScale = 1.001): THREE.LineSegments {
  const points: number[] = [];
  const at = (lat: number, lon: number) => {
    const [x, y, z] = projectHypocenter(lat, lon, 0);
    return [x * radiusScale, y * radiusScale, z * radiusScale] as const;
  };
  const push = (a: readonly number[], b: readonly number[]) => {
    points.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
  };

  // Parallels every 30 degrees, excluding the poles where they degenerate.
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 3) {
      push(at(lat, lon), at(lat, lon + 3));
    }
  }
  // Meridians every 30 degrees, pole to pole.
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -87; lat < 87; lat += 3) {
      push(at(lat, lon), at(lat + 3, lon));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x232a30, // --line
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  return new THREE.LineSegments(geometry, material);
}
