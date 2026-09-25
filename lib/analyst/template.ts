import type { Bundle, Comparison } from "./bundle";

/**
 * The deterministic explainer. Always complete and always shippable (spec §6):
 * the model only ever rewrites this, and when it fails, this is what is shown.
 */
function nextSentence(c: Comparison): string {
  const head = `Over the rest of its first year, ${c.name} had ${c.next.count} more aftershocks of M 4.5 or larger`;
  if (c.next.largest.startsWith("none")) return `${head}.`;
  const larger = c.next.largerFollowed ? `, and it was at least as large as the ${c.mag} mainshock` : "";
  return `${head}; the largest was ${c.next.largest}, ${c.next.when}${larger}.`;
}

export function renderTemplate(b: Bundle): string[] {
  if (b.limited) return [b.limited];
  const t = b.target;
  const names = (cs: Comparison[]) => cs.map((c) => `${c.name} (${c.year}, ${c.mag})`);
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  return [
    `The ${t.mag} of ${t.date}, ${t.place}: ${t.elapsed} after the mainshock there have been ${t.count} aftershocks of M 4.5 or larger, the largest ${t.largest}. By that measure the sequence is ${t.productivity}.`,
    `At the same point, it most resembles ${list(names(b.most))}. ${b.most.map((c) => `It is ${c.direction} ${c.name}.`).join(" ")}`,
    ...b.most.map(nextSentence),
    `It least resembles ${list(names(b.least))}.`,
    `Of the ${b.base.libraryCount} past sequences compared, ${b.base.largerFollowedCount} had an earthquake at least as large as their mainshock after this point.`,
  ];
}
