import { bboxAround } from "../geo/bbox";
import { analyseSequence, sequenceQueryWindow, type SequenceAnalysis } from "../science/sequence";
import type { EventRepository } from "./events";
import { createUsgsFdsnRepository } from "./usgs-fdsn";

export type SequenceResult =
  | { analysis: SequenceAnalysis; truncated: boolean }
  | { error: string };

/**
 * The only I/O behind the sequence page: resolve the mainshock, fetch its local
 * catalogue through the same repository, and hand plain arrays to the pure
 * analysis. Every failure becomes a sentence, never a thrown error.
 */
export async function loadSequence(
  mainshockId: string,
  deps: { fdsn?: EventRepository; now?: () => number } = {},
): Promise<SequenceResult> {
  const repo = deps.fdsn ?? createUsgsFdsnRepository();
  const nowMs = (deps.now ?? Date.now)();

  let mainshock;
  try {
    mainshock = await repo.byId(mainshockId);
  } catch (e) {
    return { error: `The catalogue could not be reached to look up ${mainshockId} (${message(e)}).` };
  }
  if (mainshock === null) {
    return { error: `No event with the identifier ${mainshockId} exists in the catalogue.` };
  }

  const w = sequenceQueryWindow(mainshock, nowMs);
  try {
    const page = await repo.query(
      {
        range: { startMs: w.startMs, endMs: w.endMs },
        minMagnitude: w.minMagnitude,
        maxMagnitude: null,
        minDepthKm: null,
        maxDepthKm: null,
        bbox: bboxAround(mainshock.lat, mainshock.lon, w.radiusKm),
      },
      { limit: w.rowLimit },
    );
    const truncated = page.cursor !== null || page.events.length >= w.rowLimit;
    return { analysis: analyseSequence(mainshock, page.events, nowMs), truncated };
  } catch (e) {
    return { error: `The local catalogue around ${mainshockId} could not be fetched (${message(e)}).` };
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
