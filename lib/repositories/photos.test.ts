import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWikimediaPhotoRepository } from "./photos";

const read = (name: string) => readFileSync(`test/fixtures/wikimedia/${name}`, "utf8");
const empty = JSON.stringify({ batchcomplete: true });

/** Routes each request to a fixture by what it asks for. */
function fakeFetch(routes: [RegExp, string | (() => Response)][], seen: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = decodeURIComponent(String(input).replace(/\+/g, " "));
    seen.push(url);
    for (const [re, body] of routes) {
      if (re.test(url)) return typeof body === "function" ? body() : new Response(body, { status: 200 });
    }
    return new Response(empty, { status: 200 });
  }) as typeof fetch;
}

describe("createWikimediaPhotoRepository", () => {
  it("finds the earthquake's item and gathers its photographs", async () => {
    const repo = createWikimediaPhotoRepository({
      fetchImpl: fakeFetch([
        [/query\.wikidata\.org/, read("sparql-ridgecrest.json")],
        [/gcmtitle=Category:2019 Ridgecrest earthquakes/, read("commons-ridgecrest-files.json")],
      ]),
    });
    const r = await repo.forEvent(35.77, -117.599, Date.parse("2019-07-06T03:19:53Z"));
    expect(r?.subject.label).toBe("2019 Ridgecrest earthquakes");
    expect(r?.subject.wikidataUrl).toMatch(/^https:\/\/www\.wikidata\.org\/entity\/Q/);
    // Wikidata links no category for Ridgecrest; Commons has one by its name.
    expect(r?.subject.categoryUrl).toContain("Category:2019_Ridgecrest_earthquakes");
    expect(r?.photos.length).toBeGreaterThan(0);
    expect(repo.lastError()).toBeNull();
  });

  it("reaches into subcategories when the top level is thin", async () => {
    const seen: string[] = [];
    const repo = createWikimediaPhotoRepository({
      fetchImpl: fakeFetch(
        [
          [/query\.wikidata\.org/, read("sparql-noto.json")],
          [/cmtype=subcat/, read("commons-noto-subcats.json")],
          [/gcmtitle=Category:2024 Noto earthquake&/, read("commons-noto-files.json")],
          [/gcmtitle=Category:2024 Noto earthquake damages/, read("commons-ridgecrest-files.json")],
        ],
        seen,
      ),
    });
    const r = await repo.forEvent(37.495, 137.27, Date.parse("2024-01-01T07:10:09Z"));
    expect(seen.some((u) => u.includes("Category:2024 Noto earthquake damages"))).toBe(true);
    expect(seen.some((u) => u.includes("Maps of the 2024"))).toBe(false);
    expect(r!.photos.length).toBeGreaterThan(3);
    expect(new Set(r!.photos.map((p) => p.file)).size).toBe(r!.photos.length);
  });

  it("returns null when no earthquake item matches", async () => {
    const repo = createWikimediaPhotoRepository({
      fetchImpl: fakeFetch([[/query\.wikidata\.org/, JSON.stringify({ results: { bindings: [] } })]]),
    });
    expect(await repo.forEvent(-20, -175, Date.now())).toBeNull();
    expect(repo.lastError()).toBeNull();
  });

  it("returns null when the item has nothing filed", async () => {
    const repo = createWikimediaPhotoRepository({
      fetchImpl: fakeFetch([[/query\.wikidata\.org/, read("sparql-ridgecrest.json")]]),
    });
    expect(await repo.forEvent(35.77, -117.599, Date.parse("2019-07-06T03:19:53Z"))).toBeNull();
  });

  it("returns null and records why when Wikidata fails, rather than throwing", async () => {
    const repo = createWikimediaPhotoRepository({
      fetchImpl: fakeFetch([[/query\.wikidata\.org/, () => new Response("busy", { status: 429 })]]),
    });
    expect(await repo.forEvent(0, 0, Date.now())).toBeNull();
    expect(repo.lastError()).toContain("429");
  });

  it("identifies itself to Wikimedia, as its policy requires", async () => {
    let ua = "";
    const repo = createWikimediaPhotoRepository({
      fetchImpl: (async (_: RequestInfo | URL, init?: RequestInit) => {
        ua = new Headers(init?.headers).get("User-Agent") ?? "";
        return new Response(JSON.stringify({ results: { bindings: [] } }));
      }) as typeof fetch,
    });
    await repo.forEvent(0, 0, Date.now());
    expect(ua).toMatch(/^seismograph\/.+github\.com/);
  });
});
