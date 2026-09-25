import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cameraPose, clampState, flyPath, maxTilt, MIN_ALTITUDE, raySphere, rotateBy, surface, type CameraState } from "./camera";

const base: CameraState = { lon: 0, lat: 0, altitude: 3, heading: 0, tilt: 0 };

function screen(s: CameraState, lat: number, lon: number) {
  const p = cameraPose(s);
  const cam = new THREE.PerspectiveCamera(45, 1, 1e-5, 100);
  cam.position.set(...p.position);
  cam.up.set(...p.up);
  cam.lookAt(...p.target);
  cam.updateMatrixWorld();
  return new THREE.Vector3(...surface(lat, lon)).project(cam);
}

describe("cameraPose", () => {
  it("looks straight down with north up at tilt 0, matching the old orbit camera", () => {
    const p = cameraPose(base);
    expect(p.position.map((v) => +v.toFixed(9))).toEqual([3, 0, 0]);
    expect(screen(base, 5, 0).y).toBeGreaterThan(0.01);
    expect(screen(base, 0, 5).x).toBeGreaterThan(0.01); // east is right
  });

  it("heading 90 puts east at the top of the screen", () => {
    const s = { ...base, heading: 90 };
    expect(screen(s, 0, 5).y).toBeGreaterThan(0.01);
    expect(Math.abs(screen(s, 0, 5).x)).toBeLessThan(1e-6);
  });

  it("tilting keeps the target centred and moves the camera behind it", () => {
    const s = { ...base, altitude: 1.001, tilt: 60 };
    const t = screen(s, 0, 0);
    expect(Math.abs(t.x)).toBeLessThan(1e-6);
    expect(Math.abs(t.y)).toBeLessThan(1e-6);
    // Looking north, the camera sits south of its target.
    expect(cameraPose(s).position[1]).toBeLessThan(0);
  });
});

describe("limits", () => {
  it("allows tilt only close to the ground", () => {
    expect(maxTilt(3)).toBe(0);
    expect(maxTilt(1.001)).toBe(75);
    expect(clampState({ ...base, altitude: 3, tilt: 60 }).tilt).toBe(0);
    expect(clampState({ ...base, altitude: 0.5 }).altitude).toBe(MIN_ALTITUDE);
    expect(clampState({ ...base, lon: 190, heading: -30 })).toMatchObject({ lon: -170, heading: 330 });
    expect(clampState({ lon: NaN, lat: NaN, altitude: NaN, heading: NaN, tilt: NaN }).altitude).toBe(3.2);
  });
});

describe("grab", () => {
  it("finds the ground under a ray", () => {
    const hit = raySphere([3, 0, 0], [-1, 0, 0])!;
    expect(hit.map((v) => +v.toFixed(9))).toEqual([1, 0, 0]);
    expect(raySphere([3, 0, 0], [1, 0, 0])).toBeNull();
    expect(raySphere([3, 0, 0], [0, 1, 0])).toBeNull();
  });

  it("moves the grabbed point to the cursor", () => {
    // Grab Tokyo and drag it to where the target was: the target becomes Tokyo.
    const s = { lon: 135, lat: 35, altitude: 1.5, heading: 0, tilt: 0 };
    const out = rotateBy(s, surface(35.68, 139.69), surface(35, 135));
    expect(out.lat).toBeCloseTo(35.68, 6);
    expect(out.lon).toBeCloseTo(139.69, 6);
  });

  it("keeps the view's heading steady while dragging east–west", () => {
    const s = { lon: 0, lat: 40, altitude: 1.3, heading: 20, tilt: 0 };
    const out = rotateBy(s, surface(40, 10), surface(40, 0));
    expect(out.heading).toBe(20);
    expect(out.lon).toBeCloseTo(10, 9);
  });
});

describe("flyPath", () => {
  it("starts and ends where it should and rises in between on a long flight", () => {
    const a = { lon: -117, lat: 35, altitude: 1.01, heading: 0, tilt: 0 };
    const b = { lon: 139, lat: 35, altitude: 1.01, heading: 0, tilt: 0 };
    expect(flyPath(a, b, 0)).toMatchObject({ lat: 35, lon: -117 });
    const end = flyPath(a, b, 1);
    expect(end.lat).toBeCloseTo(35, 6);
    expect(end.lon).toBeCloseTo(139, 6);
    expect(flyPath(a, b, 0.5).altitude).toBeGreaterThan(2);
  });
});
