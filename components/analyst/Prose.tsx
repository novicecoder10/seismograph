"use client";

import { useEffect, useState } from "react";

export type ProseKind = "event" | "sequence" | "compare";

type Polish = { mode: "model" | "template"; paragraphs?: string[]; reason?: string | null; rewriting?: boolean };

const reasonText: Record<string, string> = {
  "no-key": "Language-model rewriting is off on this server (no API key is configured).",
  "rate-limited": "Language-model rewriting is paused: this server's hourly limit is reached.",
  limited: "",
};

const FROM = { event: "from the catalogue's facts about this earthquake", sequence: "from the statistics on this page", compare: "from the numbers in the tables" } as const;

/**
 * Plain-language text in two steps: the deterministic template first (given by
 * the server page, or fetched at once), then, when a language model is
 * configured, its rewrite, shown only if it passed verification. Every number,
 * name and comparison in the rewrite appears in the evidence, and it says
 * nothing about the future.
 */
export function Prose({ eventId, kind = "compare", template, compact = false, testId = "compare-prose" }: { eventId: string; kind?: ProseKind; template?: string[]; compact?: boolean; testId?: string }) {
  const from = FROM[kind];
  const [state, setState] = useState<{ paragraphs: string[]; note: string; ai: boolean; busy: boolean }>({
    paragraphs: template ?? [],
    note: template ? `Written from a fixed template, ${from}.` : "Loading…",
    ai: false,
    busy: true,
  });

  useEffect(() => {
    let cancelled = false;
    const post = (extra: Record<string, unknown>) =>
      fetch("/api/analyst", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, kind, ...extra }) }).then((r) => r.json() as Promise<Polish>);
    (async () => {
      let rewriting = true;
      if (!template && kind !== "compare") {
        const d = await post({ draft: true }).catch(() => null);
        if (cancelled) return;
        rewriting = d?.rewriting ?? false;
        setState({
          paragraphs: d?.paragraphs ?? [],
          note: d?.paragraphs?.length ? `Written from a fixed template, ${from}.${rewriting ? " A language model is rewriting it in plainer words; this can take a minute or two." : ""}` : d?.reason ?? "Unavailable.",
          ai: false,
          busy: rewriting,
        });
        if (!rewriting || !d?.paragraphs?.length) return;
      } else {
        setState((s) => ({ ...s, note: `Written from a fixed template, ${from}. A language model is rewriting it in plainer words; this can take a minute or two, and the rewrite appears only if it passes verification.` }));
      }
      const p = await post({}).catch(() => null);
      if (cancelled) return;
      if (p?.mode === "model" && p.paragraphs?.length) {
        setState({ paragraphs: p.paragraphs, ai: true, busy: false, note: `Written by a language model ${from}, and checked by software: every number, name and comparison in it appears in the evidence, and it says nothing about the future.` });
      } else {
        const why = p?.reason && reasonText[p.reason] !== undefined ? reasonText[p.reason] : p?.reason ? `The rewrite was not used: ${p.reason}.` : "";
        setState((s) => ({ ...s, busy: false, note: `Written from a fixed template, ${from}. ${why}`.trim() }));
      }
    })();
    return () => { cancelled = true; };
    // template is a server-rendered seed; it does not change for an eventId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, kind]);

  const size = compact ? 12 : 13;
  return (
    <div data-testid={testId} data-ai={state.ai ? "model" : "template"}>
      {state.paragraphs.map((p, i) => <p key={i} style={{ fontSize: size, lineHeight: 1.55, margin: "0 0 7px", color: compact ? "#dfe5ea" : "var(--text-dim)" }}>{p}</p>)}
      <p data-testid={`${testId}-source`} style={{ fontSize: compact ? 10 : 11, color: compact ? "#8d979f" : "var(--text-faint)", margin: 0, display: "flex", gap: 6, alignItems: "baseline" }}>
        <span style={{ border: "1px solid currentColor", borderRadius: 3, padding: "0 4px", fontSize: compact ? 9 : 10, letterSpacing: "0.04em", whiteSpace: "nowrap", flexShrink: 0, color: state.ai ? "#9cc4ff" : "inherit" }}>
          {state.ai ? "AI · verified" : state.busy ? "AI writing…" : "template"}
        </span>
        <span>{state.note}</span>
      </p>
    </div>
  );
}
