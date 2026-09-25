import { buildBundle } from "@/lib/analyst/bundle";
import { answer, anthropicCall, bundleHash, polish, spendGuard, type Generated } from "@/lib/analyst/generate";
import { loadLibrary, loadTarget } from "@/lib/analyst/load";
import { classify, ROUTED_REPLY } from "@/lib/analyst/verify";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";

/**
 * The explainer's only door to a language model. The bundle is always rebuilt
 * here from the catalogue: nothing the browser sends is treated as evidence.
 * The key is the owner's (ANTHROPIC_API_KEY); without it, the template stands.
 */
const repo = createUsgsFdsnRepository();
const guard = spendGuard(Number(process.env.ANALYST_MAX_PER_HOUR ?? 30));
const cache = new Map<string, Generated>();

export async function POST(req: Request) {
  let body: { eventId?: unknown; question?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (question) {
    const intent = classify(question);
    // Routed before any catalogue or model work: these never reach a generator.
    if (intent !== "explain") return Response.json({ kind: "routed", intent, text: ROUTED_REPLY[intent] });
  }
  const event = await repo.byId(eventId).catch(() => null);
  if (!event) return Response.json({ error: "no such event" }, { status: 404 });
  const bundle = buildBundle(await loadTarget(event, repo, Date.now()), loadLibrary(), Date.now());

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ kind: question ? "answer" : "polish", mode: "template", reason: "no-key" });
  const call = anthropicCall(key, process.env.ANALYST_MODEL ?? "claude-sonnet-5");

  if (question) {
    if (!guard.take()) return Response.json({ kind: "answer", mode: "none", reason: "rate-limited" });
    const a = await answer(bundle, question, call).catch(() => ({ text: "", mode: "none" as const, violations: [] }));
    return Response.json({ kind: "answer", ...a });
  }
  const h = bundleHash(bundle);
  const hit = cache.get(h);
  if (hit) return Response.json({ kind: "polish", ...hit, cached: true });
  if (!guard.take()) return Response.json({ kind: "polish", mode: "template", reason: "rate-limited" });
  const g = await polish(bundle, call);
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  cache.set(h, g);
  return Response.json({ kind: "polish", ...g });
}
