import { error, json, preflight } from "@/lib/api/respond";
import { sequenceSummary } from "@/lib/api/v1";
import { ATTRIBUTION } from "@/lib/export/formats";
import { loadSequence } from "@/lib/repositories/sequence";

/** GET /api/v1/sequence/{id} — Mc, b-value, Omori, ETAS, declustering; every refusal kept. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const r = await loadSequence(id);
  if ("error" in r) return error(r.error, /No event/.test(r.error) ? 404 : 502);
  return json({ attribution: ATTRIBUTION, ...sequenceSummary(r.analysis, r.truncated) }, { maxAge: 600 });
}

export const OPTIONS = preflight;
