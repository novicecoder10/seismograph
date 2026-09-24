import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ScoreboardView } from "@/components/scoreboard/ScoreboardView";
import { summarise } from "@/lib/ledger/summary";

export const revalidate = 600;

function read(name: string): string {
  try {
    return readFileSync(path.join(process.cwd(), "ledger", name), "utf8");
  } catch {
    return "";
  }
}

export default function ScoreboardPage() {
  const sb = summarise(read("forecasts.jsonl"), read("scores.jsonl"), Date.now());
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 22px 60px" }}>
      <Link href="/" style={{ color: "var(--text-dim)", fontSize: 12 }}>← back to the globe</Link>
      <div style={{ marginTop: 18 }}>
        <ScoreboardView sb={sb} />
      </div>
    </main>
  );
}
