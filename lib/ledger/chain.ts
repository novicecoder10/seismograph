import { createHash } from "node:crypto";

/**
 * An append-only, hash-chained JSON Lines log. Each line is
 * { entry, prev, hash } with hash = sha256(prev + canonical(entry)), so altering,
 * removing or reordering any line invalidates every hash after it.
 */
export interface LedgerLine<T> {
  entry: T;
  prev: string;
  hash: string;
}

export const GENESIS = "0".repeat(64);

/** JSON with object keys sorted at every depth: one byte sequence per value. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`cannot hash non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function hashLine(prev: string, entry: unknown): string {
  return createHash("sha256").update(prev).update(canonical(entry)).digest("hex");
}

export function parseLedger<T>(text: string): LedgerLine<T>[] {
  return text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as LedgerLine<T>);
}

export function appendLine<T>(lines: LedgerLine<T>[], entry: T): LedgerLine<T> {
  const prev = lines.length ? lines[lines.length - 1]!.hash : GENESIS;
  return { entry, prev, hash: hashLine(prev, entry) };
}

export function serialiseLine<T>(line: LedgerLine<T>): string {
  return `${canonical(line)}\n`;
}

/** null when intact; otherwise the first broken line and why. */
export function verifyLedger<T>(lines: LedgerLine<T>[]): { index: number; reason: string } | null {
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.prev !== prev) return { index: i, reason: "does not follow the line before it (a line was removed, inserted or reordered)" };
    if (hashLine(l.prev, l.entry) !== l.hash) return { index: i, reason: "its content does not match its hash (the line was edited)" };
    prev = l.hash;
  }
  return null;
}
