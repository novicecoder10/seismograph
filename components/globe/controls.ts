import type { GlobeRenderer } from "./GlobeRenderer";

export interface ControlCallbacks {
  /** A press and release without a drag. */
  onClick?(x: number, y: number): void;
  /** The pointer moved with no button down (hover). */
  onHover?(x: number, y: number): void;
  /** Any camera gesture started: hide hover UI. */
  onGesture?(): void;
  onLeave?(): void;
}

/**
 * Google Earth's mouse model, shared by every globe in the app:
 *   drag                 grab the ground and move it (with a flick of inertia)
 *   wheel                zoom toward the cursor
 *   right-drag,
 *   ctrl/shift-drag      turn (left–right) and tilt (up–down)
 *   double-click         fly in toward that point
 *   two-finger touch     pinch to zoom, drag to move
 *   arrows, + and −      pan and zoom from the keyboard
 * Returns a function that removes every listener.
 */
export function attachControls(canvas: HTMLCanvasElement, renderer: GlobeRenderer, cb: ControlCallbacks = {}): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: "grab" | "turn" | null = null;
  let last = { x: 0, y: 0 };
  let downAt = { x: 0, y: 0 };
  let dragged = false;
  let pinch: number | null = null;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      return;
    }
    mode = e.button === 2 || e.ctrlKey || e.shiftKey ? "turn" : "grab";
    last = p;
    downAt = p;
    dragged = false;
    canvas.style.cursor = "grabbing";
  };

  const move = (e: PointerEvent) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pointers.size === 2 && pinch !== null) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d > 0) renderer.zoomBy(pinch / d, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      pinch = d;
      dragged = true;
      return;
    }
    if (mode === null) {
      cb.onHover?.(p.x, p.y);
      return;
    }
    if (!dragged && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 3) {
      dragged = true;
      cb.onGesture?.();
    }
    if (!dragged) return;
    if (mode === "grab") renderer.grab(last.x, last.y, p.x, p.y);
    else renderer.turnBy((p.x - last.x) * 0.3, -(p.y - last.y) * 0.25);
    last = p;
  };

  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size > 0) return;
    const wasMode = mode;
    mode = null;
    canvas.style.cursor = "grab";
    if (wasMode === "grab" && dragged) renderer.release();
    // A drag is not a click: releasing after moving the planet must not select.
    if (!dragged && e.button === 0) cb.onClick?.(downAt.x, downAt.y);
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    // Trackpads send many small deltas, mice a few large ones: scale by size.
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    renderer.zoomBy(Math.exp(Math.max(-1, Math.min(1, delta * 0.0022))), p.x, p.y);
    cb.onGesture?.();
  };

  const dbl = (e: MouseEvent) => {
    const p = local(e);
    const g = renderer.groundAt(p.x, p.y);
    if (g === null) return;
    const cam = renderer.getCamera();
    renderer.flyTo({ ...cam, lat: g.lat, lon: g.lon, altitude: 1 + (cam.altitude - 1) / 3.5 }, 900);
  };

  const key = (e: KeyboardEvent) => {
    const cam = renderer.getCamera();
    const step = Math.min(20, (cam.altitude - 1) * 25);
    const r = canvas.getBoundingClientRect();
    if (e.key === "ArrowLeft") renderer.setCamera({ ...cam, lon: cam.lon - step });
    else if (e.key === "ArrowRight") renderer.setCamera({ ...cam, lon: cam.lon + step });
    else if (e.key === "ArrowUp") renderer.setCamera({ ...cam, lat: cam.lat + step });
    else if (e.key === "ArrowDown") renderer.setCamera({ ...cam, lat: cam.lat - step });
    else if (e.key === "+" || e.key === "=") renderer.zoomBy(0.6, r.width / 2, r.height / 2);
    else if (e.key === "-" || e.key === "_") renderer.zoomBy(1 / 0.6, r.width / 2, r.height / 2);
    else if (e.key === "n" || e.key === "N") renderer.resetOrientation();
    else return;
    e.preventDefault();
  };

  const leave = () => {
    if (mode === null) cb.onLeave?.();
  };
  const context = (e: Event) => e.preventDefault();

  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";
  if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("dblclick", dbl);
  canvas.addEventListener("keydown", key);
  canvas.addEventListener("contextmenu", context);
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    canvas.removeEventListener("pointerleave", leave);
    canvas.removeEventListener("wheel", wheel);
    canvas.removeEventListener("dblclick", dbl);
    canvas.removeEventListener("keydown", key);
    canvas.removeEventListener("contextmenu", context);
  };
}
