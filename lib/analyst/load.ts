import { readFileSync } from "node:fs";
import path from "node:path";
import type { Event } from "../events/types";
import { bboxAround } from "../geo/bbox";
import type { EventRepository } from "../repositories/events";
import { greatCircleKm } from "../science/distance";
import { wellsCoppersmithRuptureKm } from "../science/sequence";
import type { TargetSequence } from "./bundle";
import { FLOOR_MAG, type LibrarySequence } from "./features";

const DAY = 86_400_000;
let library: LibrarySequence[] | null = null;

export function loadLibrary(): LibrarySequence[] {
  library ??= (JSON.parse(readFileSync(path.join(process.cwd(), "data/sequences/library.json"), "utf8")) as { sequences: LibrarySequence[] }).sequences;
  return library;
}

/** The same radius and window the library was built with, so the comparison is like for like. */
export function comparisonRadiusKm(mag: number): number {
  return Math.min(300, Math.max(30, wellsCoppersmithRuptureKm(mag)));
}

export async function loadTarget(event: Event, repo: EventRepository, nowMs: number): Promise<TargetSequence> {
  const radiusKm = comparisonRadiusKm(event.magnitude);
  const page = await repo.query(
    {
      range: { startMs: event.time - 30 * DAY, endMs: Math.min(nowMs, event.time + 365 * DAY) },
      minMagnitude: FLOOR_MAG, maxMagnitude: null, minDepthKm: null, maxDepthKm: null,
      bbox: bboxAround(event.lat, event.lon, radiusKm),
    },
    { limit: 20_000 },
  );
  const events = page.events
    .filter((e) => e.id !== event.id && greatCircleKm(event.lat, event.lon, e.lat, e.lon) <= radiusKm)
    .map((e) => [(e.time - event.time) / DAY, e.magnitude, e.depthKm] as [number, number, number | null]);
  return { id: event.id, mag: event.magnitude, time: event.time, place: event.place, radiusKm, events };
}
