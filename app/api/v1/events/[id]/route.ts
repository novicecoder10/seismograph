import { error, json, message, preflight } from "@/lib/api/respond";
import { eventLinks } from "@/lib/api/v1";
import { ATTRIBUTION } from "@/lib/export/formats";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";

/** GET /api/v1/events/{id} — one event, with links to its sequence and forecast. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  try {
    const event = await createUsgsFdsnRepository().byId(id);
    if (event === null) return error(`No event with the identifier ${id} exists in the catalogue.`, 404);
    return json({ attribution: ATTRIBUTION, event, links: eventLinks(event, new URL(req.url).origin) }, { maxAge: 300 });
  } catch (e) {
    return error(`The upstream catalogue could not be reached (${message(e)}).`, 502);
  }
}

export const OPTIONS = preflight;
