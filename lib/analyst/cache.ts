import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Generated } from "./generate";

/**
 * Verified rewrites, kept on disk by evidence hash. A free model allows about
 * fifty calls a day; an earthquake's summary should cost one of them once, not
 * once per visitor or per server restart. Only model output that passed the
 * verifier is kept. The file is git-ignored (`.cache/`).
 */
const FILE = path.join(process.cwd(), ".cache", "analyst.json");
const LIMIT = 5000;

let memory: Map<string, Generated> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function load(): Map<string, Generated> {
  if (memory) return memory;
  memory = new Map();
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Generated>;
    for (const [k, v] of Object.entries(raw)) if (v && v.mode === "model" && Array.isArray(v.paragraphs)) memory.set(k, v);
  } catch {
    // No file yet, or unreadable: start empty.
  }
  return memory;
}

function persist(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(load())));
      renameSync(tmp, FILE); // atomic: a crash never leaves half a file
    } catch {
      // A read-only host keeps the in-memory cache; nothing is lost but reuse.
    }
  }, 500);
}

export function cached(hash: string): Generated | undefined {
  return load().get(hash);
}

export function remember(hash: string, g: Generated): void {
  if (g.mode !== "model") return;
  const m = load();
  m.set(hash, g);
  while (m.size > LIMIT) m.delete(m.keys().next().value!);
  persist();
}
