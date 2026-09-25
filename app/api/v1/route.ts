import { json, preflight } from "@/lib/api/respond";
import { API_VERSION, FORMATS } from "@/lib/api/v1";

/** GET /api/v1 — a machine-readable index; the human one is /api. */
export async function GET(req: Request) {
  const o = new URL(req.url).origin;
  return json({
    version: API_VERSION,
    documentation: `${o}/api`,
    endpoints: {
      events: `${o}/api/v1/events?starttime=&endtime=&minmagnitude=&maxmagnitude=&mindepth=&maxdepth=&minlatitude=&maxlatitude=&minlongitude=&maxlongitude=&limit=&offset=&format=${FORMATS.join("|")}`,
      event: `${o}/api/v1/events/{id}`,
      sequence: `${o}/api/v1/sequence/{id}`,
      forecast: `${o}/api/v1/forecast/{id}`,
      mechanisms: `${o}/api/v1/mechanisms?starttime=&endtime=`,
      scoreboard: `${o}/api/v1/scoreboard`,
    },
    terms: "Free, no key, hobby and research use. Be gentle: responses are cached, and upstream services are public infrastructure.",
  }, { maxAge: 3600 });
}

export const OPTIONS = preflight;
