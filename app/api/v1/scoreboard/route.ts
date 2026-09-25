import { readFileSync } from "node:fs";
import path from "node:path";
import { json, preflight } from "@/lib/api/respond";
import { summarise } from "@/lib/ledger/summary";

function read(name: string): string {
  try {
    return readFileSync(path.join(process.cwd(), "ledger", name), "utf8");
  } catch {
    return "";
  }
}

/** GET /api/v1/scoreboard — the self-scoring summary, failures included. */
export async function GET() {
  return json(summarise(read("forecasts.jsonl"), read("scores.jsonl"), Date.now()), { maxAge: 600 });
}

export const OPTIONS = preflight;
