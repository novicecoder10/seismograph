"use client";

import { useEffect, useState } from "react";

type Polish = { mode: "model" | "template"; paragraphs?: string[]; reason?: string | null };

const reasonText: Record<string, string> = {
  "no-key": "Language-model rewriting is off on this server (no API key is configured).",
  "rate-limited": "Language-model rewriting is paused: this server's hourly limit is reached.",
  limited: "",
};

/** The template's paragraphs, replaced by the model's rewrite only when the
 *  server returns one that passed verification. */
export function Prose({ eventId, template }: { eventId: string; template: string[] }) {
  const [state, setState] = useState<{ paragraphs: string[]; note: string }>({
    paragraphs: template,
    note: "Written from a fixed template, from the numbers in the tables. A language model is rewriting it now; free models can take a minute or two, and the rewrite appears here only if it passes verification.",
  });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/analyst", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId }) })
      .then((r) => r.json())
      .then((p: Polish) => {
        if (cancelled) return;
        if (p.mode === "model" && p.paragraphs?.length) {
          setState({ paragraphs: p.paragraphs, note: "Rewritten by a language model from the numbers in the tables, and checked by software: every number, name and comparison in it appears in the evidence, and it contains no statement about the future." });
        } else if (p.reason && reasonText[p.reason] !== undefined) {
          setState((s) => ({ ...s, note: `Written from a fixed template, from the numbers in the tables. ${reasonText[p.reason!]}`.trim() }));
        } else if (p.reason) {
          setState((s) => ({ ...s, note: `Written from a fixed template: ${p.reason}.` }));
        }
      })
      .catch(() => setState((s) => ({ ...s, note: "Written from a fixed template, from the numbers in the tables." })));
    return () => { cancelled = true; };
  }, [eventId]);
  return (
    <div data-testid="compare-prose">
      {state.paragraphs.map((p, i) => <p key={i} style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 8px", color: "var(--text-dim)" }}>{p}</p>)}
      <p data-testid="compare-prose-source" style={{ fontSize: 11, color: "var(--text-faint)", margin: 0 }}>{state.note}</p>
    </div>
  );
}
