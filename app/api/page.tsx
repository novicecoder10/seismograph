import Link from "next/link";
import { DEFAULT_DAYS, DEFAULT_LIMIT, FORMATS, MAX_LIMIT } from "@/lib/api/v1";

export const metadata = { title: "API · Seismograph" };

const cell = { padding: "6px 10px", borderBottom: "1px solid var(--line)", textAlign: "left" as const, verticalAlign: "top" as const };
const head = { ...cell, color: "var(--text-dim)", fontWeight: 500 };
const code = { fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12 };
const pre: React.CSSProperties = { ...code, background: "var(--bg-panel)", border: "1px solid var(--line)", padding: 12, overflowX: "auto", margin: "8px 0 0" };

const ENDPOINTS: [string, string][] = [
  ["GET /api/v1/events", `The M4.5+ catalogue. FDSN parameter names; defaults to the last ${DEFAULT_DAYS} days. Formats: ${FORMATS.join(", ")}.`],
  ["GET /api/v1/events/{id}", "One event, with links to its sequence and forecast."],
  ["GET /api/v1/sequence/{id}", "Completeness (MAXC, GFT), b-value (Aki–Utsu, b-positive), Omori–Utsu, ETAS, and declustering by two methods. Every statistic that could not be estimated says why."],
  ["GET /api/v1/forecast/{id}", "The USGS aftershock forecast when one is published, with this project's reproduction error; otherwise a Reasenberg–Jones forecast computed here; otherwise the reason none is given."],
  ["GET /api/v1/mechanisms", "Global CMT moment tensors between starttime and endtime (default: last 30 days, at most three years)."],
  ["GET /api/v1/scoreboard", "The public self-scoring summary: information gain against the baseline, N-test pass rate, calibration, every failure."],
];

const PARAMS: [string, string][] = [
  ["starttime, endtime", "ISO 8601 (UTC when no offset is given) or epoch milliseconds"],
  ["minmagnitude, maxmagnitude", "magnitude bounds; the floor is 4.5"],
  ["mindepth, maxdepth", "kilometres"],
  ["minlatitude, maxlatitude, minlongitude, maxlongitude", "a bounding box: all four or none; a box across the antimeridian works"],
  ["limit, offset", `page size (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT.toLocaleString()}) and start; JSON responses give the next page's URL`],
  ["format", FORMATS.join(" | ")],
];

export default function ApiDocs() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "22px 22px 60px", lineHeight: 1.6 }}>
      <Link href="/" style={{ color: "var(--text-dim)", fontSize: 12 }}>← back to the globe</Link>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "18px 0 4px" }}>Public API, v1</h1>
      <p style={{ color: "var(--text-dim)", marginTop: 0 }} data-testid="api-terms">
        Free, no key, CORS-open, JSON by default. Hobby and research use. Responses are cached; the upstream services
        (USGS, EMSC, Global CMT) are public infrastructure, so please cache on your side too.
      </p>

      <h2 style={{ fontSize: 15, marginTop: 26 }}>Endpoints</h2>
      <div style={{ overflowX: "auto" }}>
        <table data-testid="api-endpoints" style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <thead><tr><th style={head}>endpoint</th><th style={head}>returns</th></tr></thead>
          <tbody>
            {ENDPOINTS.map(([e, d]) => (
              <tr key={e}><td style={{ ...cell, ...code, whiteSpace: "nowrap" }}>{e}</td><td style={cell}>{d}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 26 }}>Event query parameters</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <tbody>
            {PARAMS.map(([p, d]) => (
              <tr key={p}><td style={{ ...cell, ...code }}>{p}</td><td style={cell}>{d}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 26 }}>Examples</h2>
      <pre style={pre}>{`# The Ridgecrest sequence as CSV
curl "/api/v1/events?starttime=2019-07-04&endtime=2019-08-04&minlatitude=35&maxlatitude=36.5&minlongitude=-118.2&maxlongitude=-117&format=csv"

# Its forecast
curl "/api/v1/forecast/ci38457511"`}</pre>
      <pre style={pre}>{`import pandas as pd, requests

r = requests.get("https://<this site>/api/v1/events", params={"minmagnitude": 6, "starttime": "2025-01-01"})
df = pd.json_normalize(r.json()["events"])`}</pre>

      <h2 style={{ fontSize: 15, marginTop: 26 }}>Errors and honesty</h2>
      <p>
        A bad query returns 400 with <code style={code}>{`{"error": "…"}`}</code> in plain English; an unknown event 404; an
        unreachable upstream 502. Nothing is estimated from a partial catalogue: where a statistic cannot be computed the
        response carries <code style={code}>{`{"refused": true, "reason": "…"}`}</code> in its place.
      </p>
      <p style={{ color: "var(--text-dim)", fontSize: 12 }}>
        Data: USGS ComCat (public domain), EMSC (CC BY 4.0), Global CMT. A forecast is a statement about counts of
        aftershocks, not a prediction of any single earthquake.
      </p>
    </main>
  );
}
