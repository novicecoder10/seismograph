import { bundleStrings, type Bundle } from "./bundle";

/**
 * The verifier (spec §6). Architecture, not instruction: anything the model
 * writes that is not in the bundle is rejected, however plausible it looks.
 */

export interface Violation {
  kind: "numeral" | "number-word" | "name" | "direction" | "forbidden";
  detail: string;
}

const NUMERAL = /\d+(?:\.\d+)?/g;
const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|hundreds|thousand|thousands|million|dozen|dozens|half|twice|double|triple|quarter|several|few|many|most|majority|minority)\b/gi;
/** Forward-looking modals, reassurance, advice, and probability words the lexicon owns. */
const FORBIDDEN = /\b(will|won't|shall|going to|expect|expects|expected|expecting|likely|unlikely|probable|probably|probability|possible|possibly|could|might|may|should|must|predict\w*|forecast\w*|future|soon|imminent|overdue|safe|safer|safely|unsafe|worry|worried|concern|concerned|reassur\w*|calm|panic|evacuat\w*|shelter|danger\w*|risk\w*|chance|chances|odds|guarantee\w*|certain|certainly|definitely|surely|fortunately|unfortunately|luckily|thankfully|tsunami)\b/gi;
const SENTENCE_START_OK = new Set(["the", "it", "its", "in", "at", "of", "over", "by", "after", "among", "this", "that", "these", "those", "there", "both", "each", "all", "only", "like", "unlike", "compared", "here", "a", "an", "and", "but", "so", "for", "with", "during", "from", "on", "to", "measured", "counting", "at", "none", "no", "since", "within", "as", "comparisons"]);
const ALWAYS_OK = new Set(["M", "USGS", "ComCat", "Båth", "Reasenberg", "Jones", "Omori", "UTC", "I"]);

function vocabulary(b: Bundle): { numerals: Set<string>; words: Set<string>; numberWords: Set<string> } {
  const text = bundleStrings(b).join(" \n ");
  return {
    numerals: new Set(text.match(NUMERAL) ?? []),
    words: new Set((text.match(/[\p{L}'’-]+/gu) ?? []).map((w) => w.toLowerCase())),
    numberWords: new Set((text.match(NUMBER_WORDS) ?? []).map((w) => w.toLowerCase())),
  };
}

export function verify(text: string, b: Bundle, allowedExtra: string[] = []): Violation[] {
  const v: Violation[] = [];
  const vocab = vocabulary(b);
  for (const extra of allowedExtra) for (const w of extra.match(/[\p{L}'’-]+/gu) ?? []) vocab.words.add(w.toLowerCase());

  for (const n of text.match(NUMERAL) ?? []) if (!vocab.numerals.has(n)) v.push({ kind: "numeral", detail: n });
  for (const w of text.match(NUMBER_WORDS) ?? []) if (!vocab.numberWords.has(w.toLowerCase())) v.push({ kind: "number-word", detail: w });
  for (const w of text.match(FORBIDDEN) ?? []) v.push({ kind: "forbidden", detail: w });

  // Capitalised words must be the bundle's own names (places, sequences) or ordinary
  // sentence openers; an invented place or authority is a violation.
  for (const sentence of text.split(/(?<=[.!?:;])\s+/)) {
    const words = sentence.match(/[\p{L}'’-]+/gu) ?? [];
    words.forEach((w, i) => {
      if (!/^\p{Lu}/u.test(w) || ALWAYS_OK.has(w)) return;
      const lower = w.toLowerCase();
      if (vocab.words.has(lower)) return;
      if (i === 0 && SENTENCE_START_OK.has(lower)) return;
      v.push({ kind: "name", detail: w });
    });
  }

  // A comparison with a named past sequence must point the way the bundle says.
  for (const c of [...b.most, ...b.least]) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (!sentence.includes(c.name)) continue;
      for (const phrase of ["more productive than", "less productive than", "about as productive as"] as const) {
        if (sentence.includes(`${phrase} ${c.name}`) && phrase !== c.direction) v.push({ kind: "direction", detail: `${phrase} ${c.name}` });
      }
    }
  }
  return v;
}

/** Deterministic intent routing (spec §6): questions about what will happen never
 *  reach the generator. */
export type Intent = "prediction" | "safety" | "explain";

const PREDICTION = /\b(when|will|won't|going to|next|big one|bigger|larger one|another|again|coming|soon|tomorrow|tonight|this week|predict\w*|forecast\w*|chance|chances|odds|probab\w*|likely|expect\w*|foreshock|over|finished|ended|end)\b/i;
const SAFETY = /\b(safe|safety|evacuat\w*|leave|stay|shelter|tsunami|sleep|go home|should i|should we|danger\w*|worry|worried|scared|afraid|protect)\b/i;

export function classify(question: string): Intent {
  if (SAFETY.test(question)) return "safety";
  if (PREDICTION.test(question)) return "prediction";
  return "explain";
}

export const ROUTED_REPLY: Record<Exclude<Intent, "explain">, string> = {
  prediction:
    "This page compares the sequence with past ones; it does not say what will happen next. The aftershock forecast page gives probabilities, with their uncertainty, computed by the method the U.S. Geological Survey uses.",
  safety:
    "For anything about safety, follow your local civil-protection or emergency-management authority, and for tsunami warnings, your national tsunami warning centre. This page cannot advise on safety.",
};
