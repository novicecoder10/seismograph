import { error, json, preflight } from "@/lib/api/respond";
import { forecastBody } from "@/lib/api/v1";
import { ATTRIBUTION } from "@/lib/export/formats";
import { loadForecast } from "@/lib/repositories/forecast";

/**
 * GET /api/v1/forecast/{id} — the USGS forecast when one is published, else this
 * project's Reasenberg-Jones reproduction, else the reason none is given.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const r = await loadForecast(id);
  if ("error" in r) return error(r.error, /No event/.test(r.error) ? 404 : 502);
  return json(
    {
      attribution: ATTRIBUTION,
      note: "A statistical forecast of aftershock counts, not a prediction of any single earthquake. Hobby and research use.",
      ...forecastBody(r),
    },
    { maxAge: 600 },
  );
}

export const OPTIONS = preflight;
