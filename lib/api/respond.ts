import { API_VERSION, CORS_HEADERS } from "./v1";

/** Every v1 response is CORS-open and says which API version produced it. */
export function json(body: unknown, init: { status?: number; maxAge?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "X-Seismograph-API": API_VERSION,
      "Cache-Control": init.status !== undefined && init.status >= 400 ? "no-store" : `public, max-age=${init.maxAge ?? 60}, s-maxage=${init.maxAge ?? 60}`,
    },
  });
}

export function text(body: string, contentType: string, maxAge = 60, filename?: string): Response {
  return new Response(body, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": contentType,
      "X-Seismograph-API": API_VERSION,
      "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}`,
      ...(filename ? { "Content-Disposition": `inline; filename="${filename}"` } : {}),
    },
  });
}

export const error = (message: string, status: number) => json({ error: message }, { status });

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
