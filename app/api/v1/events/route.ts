import { error, json, message, preflight, text } from "@/lib/api/respond";
import { CONTENT_TYPE, eventLinks, parseEventQuery } from "@/lib/api/v1";
import { ATTRIBUTION, toCsv, toGeoJson, toKml, toQuakeMl, toTsv } from "@/lib/export/formats";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";

/** GET /api/v1/events — the M4.5+ catalogue, FDSN parameter names, six formats. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = parseEventQuery(url.searchParams, Date.now());
  if ("error" in q) return error(q.error, 400);
  let page;
  try {
    page = await createUsgsFdsnRepository().query(q.filter, { limit: q.limit, cursor: q.offset > 0 ? String(q.offset) : undefined });
  } catch (e) {
    return error(`The upstream catalogue could not be reached (${message(e)}).`, 502);
  }
  const events = page.events;
  const stem = `seismograph-events-${events.length}`;
  switch (q.format) {
    case "csv": return text(toCsv(events), CONTENT_TYPE.csv, 60, `${stem}.csv`);
    case "tsv": return text(toTsv(events), CONTENT_TYPE.tsv, 60, `${stem}.tsv`);
    case "geojson": return text(toGeoJson(events), CONTENT_TYPE.geojson, 60, `${stem}.geojson`);
    case "quakeml": return text(toQuakeMl(events), CONTENT_TYPE.quakeml, 60, `${stem}.xml`);
    case "kml": return text(toKml(events), CONTENT_TYPE.kml, 60, `${stem}.kml`);
    case "json": {
      const next = page.cursor !== null ? new URL(url) : null;
      next?.searchParams.set("offset", page.cursor!);
      return json({
        attribution: ATTRIBUTION,
        query: { ...q.filter, limit: q.limit, offset: q.offset },
        count: events.length,
        next: next?.toString() ?? null,
        events: events.map((e) => ({ ...e, links: eventLinks(e, url.origin) })),
      });
    }
  }
}

export const OPTIONS = preflight;
