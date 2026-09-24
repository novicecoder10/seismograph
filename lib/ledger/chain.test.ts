import { describe, expect, it } from "vitest";
import { appendLine, canonical, GENESIS, parseLedger, serialiseLine, verifyLedger, type LedgerLine } from "./chain";

function build(n: number) {
  const lines: LedgerLine<{ i: number; p: number }>[] = [];
  for (let i = 0; i < n; i++) lines.push(appendLine(lines, { i, p: i / 10 }));
  return lines;
}

describe("hash-chained ledger", () => {
  it("canonicalises key order and drops undefined", () => {
    expect(canonical({ b: 1, a: { d: [1, { z: 0, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":0}]},"b":1}');
    expect(() => canonical({ x: NaN })).toThrow();
  });

  it("round-trips through text and verifies", () => {
    const lines = build(5);
    expect(lines[0]!.prev).toBe(GENESIS);
    const text = lines.map(serialiseLine).join("");
    expect(verifyLedger(parseLedger(text))).toBeNull();
  });

  it("detects an edited value", () => {
    const lines = build(5);
    (lines[2]!.entry as { p: number }).p = 0.25;
    expect(verifyLedger(lines)).toEqual({ index: 2, reason: expect.stringMatching(/edited/) });
  });

  it("detects a deleted line", () => {
    const lines = build(5);
    lines.splice(1, 1);
    expect(verifyLedger(lines)?.index).toBe(1);
  });

  it("detects reordering", () => {
    const lines = build(5);
    [lines[3], lines[4]] = [lines[4]!, lines[3]!];
    expect(verifyLedger(lines)?.index).toBe(3);
  });

  it("detects an edit re-hashed without re-chaining", () => {
    const lines = build(4);
    const forged = appendLine(lines.slice(0, 1), { i: 1, p: 9 });
    lines[1] = forged;
    expect(verifyLedger(lines)?.index).toBe(2);
  });
});
