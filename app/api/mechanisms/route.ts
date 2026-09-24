import { fetchMechanisms } from "@/lib/structure/gcmt";

/**
 * Global CMT focal mechanisms as JSON. GCMT serves NDK files without CORS
 * headers, so the browser cannot read them directly; this route fetches,
 * parses and caches them (monthly files for a week, the quick file for an hour).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return Response.json({ error: "from and to must be epoch milliseconds, from < to" }, { status: 400 });
  }
  try {
    const mechanisms = await fetchMechanisms(from, to, async (u, revalidate) => {
      const res = await fetch(u, { next: { revalidate } } as RequestInit);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GCMT ${res.status}`);
      return res.text();
    });
    return Response.json(
      { source: "Global CMT Project (globalcmt.org)", mechanisms },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
