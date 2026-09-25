import { error, json, message, preflight } from "@/lib/api/respond";
import { cachedFetchText, fetchMechanisms, MAX_SPAN_MS } from "@/lib/structure/gcmt";

/** GET /api/v1/mechanisms?starttime&endtime — Global CMT moment tensors, CORS-open. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const t = (v: string | null) => (v === null ? NaN : /^-?\d+$/.test(v) ? Number(v) : Date.parse(v));
  const to = p.has("endtime") ? t(p.get("endtime")) : Date.now();
  const from = p.has("starttime") ? t(p.get("starttime")) : to - 30 * 86_400_000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return error("starttime and endtime must be times, starttime first", 400);
  if (to - from > MAX_SPAN_MS) return error("the span is limited to three years per request", 400);
  try {
    const mechanisms = await fetchMechanisms(from, to, cachedFetchText);
    return json({ attribution: "Global CMT Project (globalcmt.org)", count: mechanisms.length, mechanisms }, { maxAge: 3600 });
  } catch (e) {
    return error(`Global CMT could not be reached (${message(e)}).`, 502);
  }
}

export const OPTIONS = preflight;
