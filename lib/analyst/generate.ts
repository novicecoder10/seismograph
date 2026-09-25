import { createHash } from "node:crypto";
import { canonical } from "../ledger/chain";
import type { Bundle } from "./bundle";
import { renderTemplate } from "./template";
import { verify, type Violation } from "./verify";

/** Fixed definitions the model may quote when explaining; they are verified like the bundle. */
export const GLOSSARY = [
  "Productivity: how many aftershocks a sequence has produced for its mainshock's size and age, as the Reasenberg-Jones a-value; comparing it removes the effect of mainshock size and elapsed time.",
  "Båth's law: across many sequences, the largest aftershock is on average about 1.2 magnitude units smaller than the mainshock.",
  "M 4.5 floor: only earthquakes of M 4.5 and larger are counted, because the global catalogue records them completely; smaller ones are missed in much of the world.",
  "Similarity: the past sequences are ranked by how close they were, at the same elapsed time, in productivity, in the size of their largest aftershock relative to the mainshock, and in foreshock activity.",
];

export type ModelCall = (system: string, user: string) => Promise<string>;

export const SYSTEM_PROMPT = `You rewrite a short, factual explanation of an earthquake sequence for a general reader.

You are given an EVIDENCE BUNDLE and a DRAFT written from it. Rewrite the draft so it reads naturally.

Rules that are checked by software, and any violation discards your answer:
- Use only numbers, magnitudes, dates, places and sequence names that appear in the bundle, copied exactly as written there. Do not compute, round, convert or spell out numbers.
- Keep every comparison ("more productive than", "less productive than", "about as productive as") exactly as the bundle states it for each sequence.
- Say nothing about what will, could, may or might happen. Do not use: will, could, might, may, should, likely, expect, chance, odds, risk, safe, future, forecast, predict.
- Do not reassure. An explanation that sounds calming is wrong here, even if kind: people have been harmed by reassurance after earthquakes. Stay neutral and factual.
- Give no advice about safety or what anyone should do.
- Do not describe yourself, and do not present yourself as an authority.
- Keep the caveats' meaning.

Reply with JSON only: {"paragraphs": ["...", "..."]}`;

export const ANSWER_PROMPT = `You answer a reader's question about an earthquake-sequence comparison using ONLY the EVIDENCE BUNDLE and GLOSSARY given.
The same software-checked rules apply: only numbers and names from the bundle or glossary, copied exactly; no statement about what will, could, may or might happen; no reassurance; no safety advice; no self-description. If the bundle does not answer the question, say that the comparison does not cover it.
Reply with JSON only: {"answer": "..."}`;

export interface Generated {
  paragraphs: string[];
  mode: "model" | "template";
  /** Why the template was used, when it was. */
  reason: string | null;
  violations: Violation[];
}

function parseJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

export async function polish(bundle: Bundle, call: ModelCall): Promise<Generated> {
  const draft = renderTemplate(bundle);
  if (bundle.limited) return { paragraphs: draft, mode: "template", reason: "limited", violations: [] };
  let feedback = "";
  let last: Violation[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let out: { paragraphs?: unknown } | null = null;
    try {
      out = parseJson(await call(SYSTEM_PROMPT, `EVIDENCE BUNDLE:\n${JSON.stringify(bundle, null, 1)}\n\nDRAFT:\n${draft.join("\n\n")}${feedback}`));
    } catch (e) {
      return { paragraphs: draft, mode: "template", reason: `model error: ${e instanceof Error ? e.message : String(e)}`, violations: [] };
    }
    const paras = Array.isArray(out?.paragraphs) ? out!.paragraphs.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
    if (paras.length === 0) {
      last = [{ kind: "forbidden", detail: "no paragraphs in reply" }];
    } else {
      last = paras.flatMap((p) => verify(p, bundle));
      if (last.length === 0) return { paragraphs: paras, mode: "model", reason: null, violations: [] };
    }
    feedback = `\n\nYOUR PREVIOUS ANSWER WAS REJECTED FOR: ${last.map((v) => `${v.kind} "${v.detail}"`).join("; ")}. Fix these and nothing else.`;
  }
  return { paragraphs: draft, mode: "template", reason: "the rewrite failed verification twice", violations: last };
}

export async function answer(bundle: Bundle, question: string, call: ModelCall): Promise<{ text: string; mode: "model" | "none"; violations: Violation[] }> {
  let feedback = "";
  let last: Violation[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = parseJson<{ answer?: unknown }>(await call(ANSWER_PROMPT, `EVIDENCE BUNDLE:\n${JSON.stringify(bundle, null, 1)}\n\nGLOSSARY:\n${GLOSSARY.join("\n")}\n\nQUESTION: ${question.slice(0, 500)}${feedback}`));
    const text = typeof out?.answer === "string" ? out.answer.trim() : "";
    last = text ? verify(text, bundle, GLOSSARY) : [{ kind: "forbidden", detail: "empty answer" }];
    if (text && last.length === 0) return { text, mode: "model", violations: [] };
    feedback = `\n\nYOUR PREVIOUS ANSWER WAS REJECTED FOR: ${last.map((v) => `${v.kind} "${v.detail}"`).join("; ")}.`;
  }
  return { text: "", mode: "none", violations: last };
}

export function bundleHash(b: Bundle): string {
  return createHash("sha256").update(canonical(b)).digest("hex").slice(0, 24);
}

/** At most `limit` model calls per rolling hour per server instance: the owner's key,
 *  the owner's money. Exceeding it falls back to the template, never to an error. */
export function spendGuard(limit: number, now: () => number = Date.now) {
  const calls: number[] = [];
  return {
    take(): boolean {
      const t = now();
      while (calls.length && calls[0]! < t - 3_600_000) calls.shift();
      if (calls.length >= limit) return false;
      calls.push(t);
      return true;
    },
  };
}

/** Anthropic Messages API over fetch: no SDK dependency. */
export function anthropicCall(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): ModelCall {
  return async (system, user) => {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1200, temperature: 0.3, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  };
}

/**
 * OpenRouter (OpenAI-compatible chat completions). Free models are often
 * overloaded, so each call tries the models in order and moves on after an
 * error or an empty reply. Reasoning models think before answering: the budget
 * leaves room for that, and the reasoning itself is excluded from the reply.
 */
export function openRouterCall(apiKey: string, models: string[], fetchImpl: typeof fetch = fetch): ModelCall {
  return async (system, user) => {
    let last: unknown = new Error("no OpenRouter model configured");
    for (const model of models) {
      try {
        const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "x-title": "Seismograph" },
          body: JSON.stringify({
            model,
            max_tokens: 4000,
            temperature: 0.3,
            reasoning: { exclude: true },
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
          }),
        });
        if (!res.ok) throw new Error(`OpenRouter ${model} ${res.status}`);
        const j = (await res.json()) as { choices?: { message?: { content?: string | null } }[]; error?: { message?: string } };
        if (j.error) throw new Error(`OpenRouter ${model}: ${j.error.message ?? "error"}`);
        const text = j.choices?.[0]?.message?.content ?? "";
        if (text.trim() === "") throw new Error(`OpenRouter ${model}: empty reply`);
        return text;
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  };
}

/** Google Gemini API (generateContent). The key travels in a header, never the URL. */
export function geminiCall(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): ModelCall {
  return async (system, user) => {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4000 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${model} ${res.status}`);
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (text.trim() === "") throw new Error(`Gemini ${model}: empty reply`);
    return text;
  };
}

/** Tries each provider in turn; the first to answer wins. */
export function chain(calls: { label: string; call: ModelCall }[]): { label: string; call: ModelCall } {
  return {
    label: calls.map((c) => c.label).join(" → "),
    call: async (system, user) => {
      let last: unknown = new Error("no provider");
      for (const c of calls) {
        try {
          return await c.call(system, user);
        } catch (e) {
          last = e;
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
  };
}

export const DEFAULT_OPENROUTER_MODELS = ["nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3-super-120b-a12b:free"];
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * The owner's keys, in the order that costs nothing first: OpenRouter's free
 * models, then Gemini (free tier), then Anthropic. Null when no key is set,
 * and the template stands.
 */
export function providersFromEnv(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): { label: string; call: ModelCall } | null {
  // The test suite sets this: it must neither wait minutes on a free model nor
  // spend the owner's quota.
  if (env.ANALYST_OFF === "1") return null;
  const calls: { label: string; call: ModelCall }[] = [];
  if (env.OPENROUTER_API_KEY) {
    const models = (env.ANALYST_OPENROUTER_MODELS ?? DEFAULT_OPENROUTER_MODELS.join(",")).split(",").map((m) => m.trim()).filter(Boolean);
    calls.push({ label: `OpenRouter (${models.join(", ")})`, call: openRouterCall(env.OPENROUTER_API_KEY, models, fetchImpl) });
  }
  const google = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (google) {
    const model = env.ANALYST_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
    calls.push({ label: `Gemini (${model})`, call: geminiCall(google, model, fetchImpl) });
  }
  if (env.ANTHROPIC_API_KEY) {
    const model = env.ANALYST_MODEL ?? "claude-sonnet-5";
    calls.push({ label: `Anthropic (${model})`, call: anthropicCall(env.ANTHROPIC_API_KEY, model, fetchImpl) });
  }
  return calls.length === 0 ? null : chain(calls);
}
