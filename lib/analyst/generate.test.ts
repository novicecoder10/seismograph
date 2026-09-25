import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBundle, type TargetSequence } from "./bundle";
import type { LibrarySequence } from "./features";
import { anthropicCall, answer, bundleHash, geminiCall, openRouterCall, polish, providersFromEnv, spendGuard, type ModelCall } from "./generate";
import { renderTemplate } from "./template";

const lib: LibrarySequence[] = JSON.parse(readFileSync("data/sequences/library.json", "utf8")).sequences;
const k = lib.find((s) => s.name === "Kaikoura")!;
const target: TargetSequence = { id: "test:x", mag: 7.2, time: Date.UTC(2026, 8, 20), place: "near the coast of Somewhere", radiusKm: 90, events: k.events.map(([t, m, d]) => [t, m - 0.6, d]) };
const bundle = buildBundle(target, lib, Date.UTC(2026, 8, 23));
const draft = renderTemplate(bundle);

const replying = (...replies: string[]): ModelCall & { calls: number } => {
  const f = (async () => replies[Math.min(f.calls++, replies.length - 1)]!) as unknown as ModelCall & { calls: number };
  f.calls = 0;
  return f;
};

describe("polish", () => {
  it("accepts a faithful rewrite", async () => {
    const good = JSON.stringify({ paragraphs: [draft[0]!.replace("By that measure the sequence is", "Measured that way, it is")] });
    const r = await polish(bundle, replying(good));
    expect(r.mode).toBe("model");
  });

  it("retries once on a violation, then falls back to the template", async () => {
    const bad = JSON.stringify({ paragraphs: [`${draft[0]} Larger aftershocks will follow, but residents are safe.`] });
    const call = replying(bad, bad);
    const r = await polish(bundle, call);
    expect(call.calls).toBe(2);
    expect(r.mode).toBe("template");
    expect(r.paragraphs).toEqual(draft);
    expect(r.violations.map((v) => v.detail)).toEqual(expect.arrayContaining(["will", "safe"]));
  });

  it("recovers when the second attempt is clean", async () => {
    const bad = JSON.stringify({ paragraphs: ["It had 999 aftershocks."] });
    const good = JSON.stringify({ paragraphs: [draft[0]!] });
    expect((await polish(bundle, replying(bad, good))).mode).toBe("model");
  });

  it("falls back on garbage, prose outside JSON, and API errors", async () => {
    expect((await polish(bundle, replying("I cannot help with that."))).mode).toBe("template");
    expect((await polish(bundle, async () => { throw new Error("HTTP 529"); })).reason).toMatch(/529/);
  });
});

describe("answer", () => {
  it("may quote the glossary, and nothing invented", async () => {
    const ok = await answer(bundle, "What is Båth's law?", replying(JSON.stringify({ answer: "Båth's law: across many sequences, the largest aftershock is on average about 1.2 magnitude units smaller than the mainshock." })));
    expect(ok.mode).toBe("model");
    const bad = await answer(bundle, "What is Båth's law?", replying(JSON.stringify({ answer: "It says the largest aftershock is 1.5 units smaller." })));
    expect(bad.mode).toBe("none");
  });
});

describe("plumbing", () => {
  it("hashes bundles stably", () => {
    expect(bundleHash(bundle)).toBe(bundleHash(JSON.parse(JSON.stringify(bundle))));
    expect(bundleHash({ ...bundle, target: { ...bundle.target, count: "1" } })).not.toBe(bundleHash(bundle));
  });

  it("the spend guard caps calls per rolling hour", () => {
    let t = 0;
    const g = spendGuard(2, () => t);
    expect([g.take(), g.take(), g.take()]).toEqual([true, true, false]);
    t = 3_600_001;
    expect(g.take()).toBe(true);
  });

  it("calls the Messages API with the key in a header, never the body", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"paragraphs\":[]}" }] }));
    }) as unknown as typeof fetch;
    await anthropicCall("sk-test", "claude-sonnet-5", fake)("sys", "user");
    expect(seen!.url).toBe("https://api.anthropic.com/v1/messages");
    expect((seen!.init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    expect(String(seen!.init.body)).not.toContain("sk-test");
    expect(JSON.parse(String(seen!.init.body)).model).toBe("claude-sonnet-5");
  });
});

describe("free-first providers", () => {
  const recorder = (reply: (url: string, body: Record<string, unknown>) => Response) => {
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      seen.push({ url, headers: init.headers as Record<string, string>, body });
      return reply(url, body);
    }) as unknown as typeof fetch;
    return { f, seen };
  };

  it("OpenRouter: key in the Authorization header, falls through an overloaded free model to the next", async () => {
    const { f, seen } = recorder((_u, body) =>
      body.model === "a:free" ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] })),
    );
    expect(await openRouterCall("sk-or-test", ["a:free", "b:free"], f)("sys", "user")).toBe("hello");
    expect(seen.map((s) => s.body.model)).toEqual(["a:free", "b:free"]);
    expect(seen[0]!.headers.authorization).toBe("Bearer sk-or-test");
    expect(JSON.stringify(seen[0]!.body)).not.toContain("sk-or-test");
    expect(seen[0]!.body.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "user" }]);
  });

  it("OpenRouter: an empty reply counts as a failure, and all failing throws", async () => {
    const { f } = recorder(() => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] })));
    await expect(openRouterCall("k", ["a"], f)("s", "u")).rejects.toThrow(/empty/);
  });

  it("Gemini: key in a header, never the URL", async () => {
    const { f, seen } = recorder(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })));
    expect(await geminiCall("AIza-test", "gemini-2.5-flash", f)("sys", "user")).toBe("hi");
    expect(seen[0]!.url).not.toContain("AIza-test");
    expect(seen[0]!.url).toContain("gemini-2.5-flash:generateContent");
    expect(seen[0]!.headers["x-goog-api-key"]).toBe("AIza-test");
  });

  it("orders providers free first and falls back across them", async () => {
    expect(providersFromEnv({})).toBeNull();
    const { f, seen } = recorder((url) =>
      url.includes("openrouter") ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "from gemini" }] } }] })),
    );
    const p = providersFromEnv({ OPENROUTER_API_KEY: "or", GOOGLE_API_KEY: "g", ANTHROPIC_API_KEY: "a" }, f)!;
    expect(p.label).toMatch(/^OpenRouter.*→ Gemini.*→ Anthropic/);
    expect(await p.call("s", "u")).toBe("from gemini");
    expect(seen.filter((s) => s.url.includes("openrouter"))).toHaveLength(2); // both free models tried
  });
});

