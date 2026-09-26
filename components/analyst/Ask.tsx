"use client";

import Link from "next/link";
import { useState } from "react";

type Reply = { kind: "routed"; intent: "prediction" | "safety"; text: string } | { kind: "answer"; mode: "model" | "none" | "template"; text?: string; reason?: string };

export function Ask({
  eventId,
  kind = "compare",
  title = "Ask about this comparison",
  placeholder = "e.g. What does productivity mean here?",
  scope = "the tables above",
}: { eventId: string; kind?: "event" | "sequence" | "compare"; title?: string; placeholder?: string; scope?: string }) {
  const [q, setQ] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/analyst", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, kind, question: q }) });
      setReply(await r.json());
    } finally {
      setBusy(false);
    }
  };
  let body: React.ReactNode = null;
  if (reply?.kind === "routed") {
    body = (
      <p data-testid="ask-routed">
        {reply.text}{" "}
        {reply.intent === "prediction" && <Link href={`/forecast/${encodeURIComponent(eventId)}`} style={{ color: "var(--text-primary)" }}>Open the aftershock forecast →</Link>}
      </p>
    );
  } else if (reply?.kind === "answer") {
    body = reply.mode === "model" && reply.text
      ? <p data-testid="ask-answer">{reply.text}</p>
      : <p data-testid="ask-answer">{reply.reason === "no-key"
          ? `Questions need a language model, and none is configured on this server. ${scope[0]!.toUpperCase()}${scope.slice(1)} hold everything the explainer knows.`
          : reply.reason === "rate-limited"
            ? "This server's hourly limit for language-model calls is reached. Try again later."
            : "No answer passed the checks on numbers and wording, so none is shown. The question may go beyond the facts available here."}</p>;
  }
  return (
    <section data-testid="ask" style={{ border: "1px solid var(--line)", background: "var(--bg-panel)", padding: "12px 14px" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, margin: "0 0 6px" }}>{title}</h3>
      <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "0 0 8px" }}>
        Answers come only from {scope}, and are checked by software before they are shown. Questions about what will happen, or about safety, are answered with
        where to look instead, and never reach the language model.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: "flex", gap: 8 }}>
        <input data-testid="ask-input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder={placeholder}
          style={{ flex: 1, background: "var(--bg-void)", color: "var(--text-primary)", border: "1px solid var(--line)", padding: "6px 8px", fontSize: 12 }} />
        <button type="submit" disabled={busy} style={{ background: "var(--bg-panel-raised)", color: "var(--text-primary)", border: "1px solid var(--line)", padding: "6px 12px", fontSize: 12 }}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
      {body && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>{body}</div>}
    </section>
  );
}
