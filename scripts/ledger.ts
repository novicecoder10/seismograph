// Usage: vite-node scripts/ledger.ts issue | score | verify
// Appends to ledger/forecasts.jsonl and ledger/scores.jsonl. Never rewrites a line.
import { appendFileSync, readFileSync } from "node:fs";
import { parseLedger, verifyLedger } from "../lib/ledger/chain";
import { issueForecasts, scoreForecasts } from "../lib/ledger/run";
import { createUsgsFdsnRepository } from "../lib/repositories/usgs-fdsn";

// Unattended runs must survive a slow or briefly unreachable USGS: retry
// network failures and 5xx responses with backoff before giving up.
const baseFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await baseFetch(input, init);
      if (res.status < 500) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw last;
};

const FORECASTS = "ledger/forecasts.jsonl";
const SCORES = "ledger/scores.jsonl";
const read = (p: string) => readFileSync(p, "utf8");

const cmd = process.argv[2];
const deps = { events: createUsgsFdsnRepository(), now: Date.now, log: (m: string) => console.log(m) };

if (cmd === "issue") {
  const r = await issueForecasts(read(FORECASTS), deps);
  if (r.append) appendFileSync(FORECASTS, r.append);
  for (const s of r.skipped) console.log(`skipped ${s}`);
  console.log(`${r.issued.length} forecast(s) issued`);
} else if (cmd === "score") {
  const r = await scoreForecasts(read(FORECASTS), read(SCORES), deps);
  if (r.append) appendFileSync(SCORES, r.append);
  console.log(`${r.scored} score(s) recorded`);
} else if (cmd === "verify") {
  let ok = true;
  for (const p of [FORECASTS, SCORES]) {
    const lines = parseLedger(read(p));
    const broken = verifyLedger(lines);
    console.log(broken ? `${p}: BROKEN at line ${broken.index + 1}: ${broken.reason}` : `${p}: ${lines.length} lines, intact`);
    ok &&= !broken;
  }
  process.exit(ok ? 0 : 1);
} else {
  console.error("usage: ledger.ts issue | score | verify");
  process.exit(2);
}
