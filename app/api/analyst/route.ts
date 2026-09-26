import { buildBundle } from "@/lib/analyst/bundle";
import { cached, remember } from "@/lib/analyst/cache";
import { EVENT_GLOSSARY, eventEvidence, eventTemplate, sequenceEvidence, sequenceTemplate } from "@/lib/analyst/facts";
import { answer, bundleHash, EVENT_ANSWER_PROMPT, EVENT_PROMPT, polish, providersFromEnv, rewrite, SEQUENCE_PROMPT, spendGuard, type Generated } from "@/lib/analyst/generate";
import { loadLibrary, loadTarget } from "@/lib/analyst/load";
import { classify, ROUTED_REPLY, type Evidence } from "@/lib/analyst/verify";
import { regimeAt } from "@/lib/oaf/regimes";
import { loadSequence } from "@/lib/repositories/sequence";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";
import type { Event } from "@/lib/events/types";

/**
 * The plain-language layer's only door to a language model. The evidence is
 * always rebuilt here from the catalogue: nothing the browser sends is treated
 * as evidence. Three kinds:
 *   event     one earthquake (the globe's card, the event page)
 *   sequence  its aftershock statistics (the sequence page)
 *   compare   comparison with past sequences (the compare page)
 * `draft: true` returns the deterministic template at once; otherwise the
 * model's verified rewrite (or the template, with the reason). Questions are
 * routed in code first: prediction and safety never reach a model.
 * The keys are the owner's (OPENROUTER_API_KEY, GEMINI_API_KEY or GOOGLE_API_KEY,
 * ANTHROPIC_API_KEY; free providers first); without any, the template stands.
 */
const repo = createUsgsFdsnRepository();
const guard = spendGuard(Number(process.env.ANALYST_MAX_PER_HOUR ?? 30));
const inFlight = new Map<string, Promise<Generated>>();

type Kind = "event" | "sequence" | "compare";

interface Built {
  evidence: Evidence;
  draft: string[];
  prompt: string;
  glossary: string[];
  /** Compare's own rewrite path (it refuses when the evidence is thin). */
  compare?: true;
}

async function build(kind: Kind, event: Event): Promise<Built | { error: string }> {
  const now = Date.now();
  if (kind === "event") {
    let regime = null;
    try {
      regime = regimeAt(event.lat, event.lon).code;
    } catch {
      // The regime table is a reading aid; without it the setting says so.
    }
    const evidence = eventEvidence(event, regime);
    return { evidence, draft: eventTemplate(evidence), prompt: EVENT_PROMPT, glossary: EVENT_GLOSSARY };
  }
  if (kind === "sequence") {
    const r = await loadSequence(event.id, { fdsn: repo });
    if ("error" in r) return { error: r.error };
    const evidence = sequenceEvidence(r.analysis, now, event.place);
    return { evidence, draft: sequenceTemplate(evidence), prompt: SEQUENCE_PROMPT, glossary: EVENT_GLOSSARY };
  }
  const bundle = buildBundle(await loadTarget(event, repo, now), loadLibrary(), now);
  return { evidence: bundle, draft: [], prompt: "", glossary: [], compare: true };
}

export async function POST(req: Request) {
  let body: { eventId?: unknown; question?: unknown; kind?: unknown; draft?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  const kind: Kind = body.kind === "event" || body.kind === "sequence" ? body.kind : "compare";
  if (question) {
    const intent = classify(question);
    // Routed before any catalogue or model work: these never reach a generator.
    if (intent !== "explain") return Response.json({ kind: "routed", intent, text: ROUTED_REPLY[intent] });
  }
  const event = await repo.byId(eventId).catch(() => null);
  if (!event) return Response.json({ error: "no such event" }, { status: 404 });
  const built = await build(kind, event);
  if ("error" in built) return Response.json({ kind: "polish", mode: "template", paragraphs: [], reason: built.error });

  const provider = providersFromEnv(process.env);
  if (body.draft === true && !built.compare) {
    return Response.json({ kind: "polish", mode: "template", paragraphs: built.draft, reason: null, rewriting: provider !== null });
  }
  if (!provider) return Response.json({ kind: question ? "answer" : "polish", mode: "template", paragraphs: built.draft, reason: "no-key" });
  const call = provider.call;

  if (question) {
    if (!guard.take()) return Response.json({ kind: "answer", mode: "none", reason: "rate-limited" });
    const a = await (built.compare ? answer(built.evidence, question, call) : answer(built.evidence, question, call, built.glossary, EVENT_ANSWER_PROMPT))
      .catch(() => ({ text: "", mode: "none" as const, violations: [] }));
    return Response.json({ kind: "answer", ...a });
  }

  const h = `${kind}:${bundleHash(built.evidence)}`;
  const hit = cached(h);
  if (hit) return Response.json({ kind: "polish", ...hit, cached: true });
  // Free models can take minutes: readers who open the same page meanwhile
  // wait on the one call already running rather than starting their own.
  const running = inFlight.get(h);
  if (running) return Response.json({ kind: "polish", ...(await running), shared: true });
  if (!guard.take()) return Response.json({ kind: "polish", mode: "template", paragraphs: built.draft, reason: "rate-limited" });
  const job = (built.compare
    ? polish(built.evidence as Parameters<typeof polish>[0], call)
    : rewrite(built.evidence, built.draft, built.prompt, built.glossary, call)
  ).finally(() => inFlight.delete(h));
  inFlight.set(h, job);
  const g = await job;
  remember(h, g);
  return Response.json({ kind: "polish", ...g });
}
