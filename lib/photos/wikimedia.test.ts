import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FULL_WIDTH,
  THUMB_WIDTH,
  categoryFilesUrl,
  interleave,
  mergePhotos,
  parseItems,
  parsePhotos,
  parseSubcategories,
  pickItem,
  plain,
  sparqlQuery,
  type EarthquakeItem,
  type Photo,
} from "./wikimedia";

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/wikimedia/${name}`, "utf8"));

const NOTO_MS = Date.parse("2024-01-01T07:10:09Z");
const RIDGECREST_MS = Date.parse("2019-07-06T03:19:53Z");

describe("sparqlQuery", () => {
  it("filters dates from three days before the event to one after, then distance", () => {
    const q = sparqlQuery(37.495, 137.27, NOTO_MS);
    expect(q).toContain('"2023-12-29T07:10:09Z"^^xsd:dateTime');
    expect(q).toContain('"2024-01-02T07:10:09Z"^^xsd:dateTime');
    // WKT is longitude first.
    expect(q).toContain("Point(137.2700 37.4950)");
    expect(q).toContain("wd:Q7944");
    // A radius search over a populated region takes ten seconds; the date range does not.
    expect(q).not.toContain("wikibase:around");
  });
});

describe("parseItems", () => {
  it("folds one row per image into one item with every image", () => {
    const items = parseItems(fixture("sparql-noto.json"));
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe("2024 Noto earthquake");
    expect(items[0]!.category).toBe("2024 Noto earthquake");
    expect(items[0]!.images.length).toBe(2);
    expect(items[0]!.articleUrl).toContain("en.wikipedia.org");
  });

  it("reads a sequence's start and end when it has no point in time", () => {
    const item = parseItems(fixture("sparql-ridgecrest.json"))[0]!;
    expect(item.label).toBe("2019 Ridgecrest earthquakes");
    expect(new Date(item.startMs).toISOString()).toBe("2019-07-04T00:00:00.000Z");
    expect(new Date(item.endMs!).toISOString()).toBe("2019-07-05T00:00:00.000Z");
    expect(item.distanceKm).toBeLessThan(5);
  });

  it("returns nothing for a malformed response rather than throwing", () => {
    expect(parseItems(null)).toEqual([]);
    expect(parseItems({ results: {} })).toEqual([]);
  });
});

describe("pickItem", () => {
  const item = (over: Partial<EarthquakeItem>): EarthquakeItem => ({
    id: "q",
    label: "x",
    startMs: 0,
    endMs: null,
    distanceKm: 10,
    category: null,
    images: [],
    articleUrl: null,
    ...over,
  });

  it("prefers the item closest in time, then in space", () => {
    const t = Date.parse("2024-01-01T12:00:00Z");
    const sameDayFar = item({ id: "a", startMs: Date.parse("2024-01-01T00:00:00Z"), distanceKm: 200 });
    const dayBeforeNear = item({ id: "b", startMs: Date.parse("2023-12-30T00:00:00Z"), distanceKm: 1 });
    expect(pickItem([dayBeforeNear, sameDayFar], t)?.id).toBe("a");
    const sameDayNear = item({ id: "c", startMs: sameDayFar.startMs, distanceKm: 5 });
    expect(pickItem([sameDayFar, sameDayNear], t)?.id).toBe("c");
  });

  it("counts an event inside a sequence's span as no time away", () => {
    const seq = item({ id: "seq", startMs: Date.parse("2019-07-04T00:00:00Z"), endMs: Date.parse("2019-07-07T00:00:00Z"), distanceKm: 50 });
    const other = item({ id: "o", startMs: Date.parse("2019-07-06T12:00:00Z"), distanceKm: 1 });
    expect(pickItem([other, seq], RIDGECREST_MS)?.id).toBe("seq");
  });

  it("returns null when nothing matched", () => {
    expect(pickItem([], NOTO_MS)).toBeNull();
  });
});

describe("parsePhotos", () => {
  const ridgecrest = parsePhotos(fixture("commons-ridgecrest-files.json"));

  it("keeps photographs and drops maps and diagrams", () => {
    const files = ridgecrest.map((p) => p.file);
    expect(files).toContain("July 5, 2019, Ridgecrest earthquake road offset.jpg");
    expect(files.some((f) => /\.svg$/i.test(f))).toBe(false);
    expect(files.some((f) => /map/i.test(f))).toBe(false);
  });

  it("credits every photograph with an author and a licence", () => {
    expect(ridgecrest.length).toBeGreaterThan(0);
    for (const p of ridgecrest) {
      expect(p.artist.length).toBeGreaterThan(0);
      expect(p.license.length).toBeGreaterThan(0);
      expect(p.pageUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(p.artist).not.toMatch(/[<>]/);
    }
  });

  it("uses only thumbnail widths Commons serves", () => {
    for (const p of ridgecrest) {
      expect(p.thumbUrl).toContain(`/${THUMB_WIDTH}px-`);
      expect(p.thumbUrl).not.toContain("utm_");
      expect(p.fullUrl.includes(`/${FULL_WIDTH}px-`) || !p.fullUrl.includes("/thumb/")).toBe(true);
    }
  });

  const page = (title: string, over: Record<string, unknown> = {}, meta: Record<string, string> = {}) => ({
    query: {
      pages: [
        {
          title,
          imageinfo: [
            {
              url: "https://upload.wikimedia.org/a/b/X.jpg",
              thumburl: `https://upload.wikimedia.org/thumb/a/b/X.jpg/${THUMB_WIDTH}px-X.jpg`,
              descriptionurl: "https://commons.wikimedia.org/wiki/File:X.jpg",
              mime: "image/jpeg",
              width: 3000,
              height: 2000,
              extmetadata: {
                LicenseShortName: { value: "CC BY 4.0" },
                Artist: { value: '<a href="//x">Someone</a>' },
                ImageDescription: { value: meta.description ?? "A collapsed road" },
              },
              ...over,
            },
          ],
        },
      ],
    },
  });

  it("drops pictures of the dead", () => {
    expect(parsePhotos(page("File:Victims in the rubble.jpg"))).toEqual([]);
    expect(parsePhotos(page("File:Street.jpg", {}, { description: "Bodies recovered from the building" }))).toEqual([]);
    expect(parsePhotos(page("File:Street.jpg"))).toHaveLength(1);
  });

  it("drops portraits of officials, which are not of the earthquake", () => {
    expect(parsePhotos(page("File:Street.jpg", {}, { description: "Prime Minister Rishi Sunak observes a minute's silence" }))).toEqual([]);
    expect(parsePhotos(page("File:Minister visits the ministry.jpg"))).toEqual([]);
    expect(parsePhotos(page("File:Street.jpg", {}, { description: "Kılıçdaroğlu makes a press statement after the earthquakes" }))).toEqual([]);
  });

  it("drops art, too small images and files without a licence", () => {
    expect(parsePhotos(page("File:Earthquake comic.jpg"))).toEqual([]);
    expect(parsePhotos(page("File:EQB 2025 Wiki-2 page-0001.jpg"))).toEqual([]);
    expect(parsePhotos(page("File:Street.jpg", { width: 300 }))).toEqual([]);
    expect(parsePhotos(page("File:Street.jpg", { extmetadata: {} }))).toEqual([]);
    expect(parsePhotos(page("File:Street.png", { mime: "image/png" }))).toEqual([]);
  });

  it("strips HTML from the author credit", () => {
    expect(parsePhotos(page("File:Street.jpg"))[0]!.artist).toBe("Someone");
  });

  it("serves the original when it is narrower than the full view", () => {
    const p = parsePhotos(page("File:Street.jpg", { width: 1000, height: 800 }))[0]!;
    expect(p.fullUrl).toBe("https://upload.wikimedia.org/a/b/X.jpg");
    expect(p.aspect).toBeCloseTo(1.25);
  });
});

describe("parseSubcategories", () => {
  it("lists subcategories, skipping maps and officials", () => {
    const subs = parseSubcategories(fixture("commons-noto-subcats.json"));
    expect(subs).toContain("2024 Noto earthquake damages");
    expect(subs.some((s) => /maps/i.test(s))).toBe(false);
    expect(subs.some((s) => /politicians/i.test(s))).toBe(false);
    // Damage first, ahead of aerial imagery that sorts earlier.
    expect(subs[0]).toBe("2024 Noto earthquake damages");
  });
});

describe("merging", () => {
  const photo = (file: string) => ({ file, artist: file }) as Photo;

  it("interleaves lists so one does not crowd out the rest", () => {
    expect(interleave([[1, 2, 3], [4], [5, 6]])).toEqual([1, 4, 5, 2, 6, 3]);
  });

  it("takes at most a few photographs from any one photographer", () => {
    const by = (file: string, artist: string) => ({ file, artist }) as Photo;
    const run = ["a", "b", "c", "d", "e"].map((f) => by(f, "Dosseman"));
    const merged = mergePhotos([[...run, by("x", "Someone else")]], 12, 3);
    expect(merged.map((p) => p.file)).toEqual(["a", "b", "c", "x"]);
  });

  it("keeps each file once, in group order, up to the limit", () => {
    const merged = mergePhotos([[photo("a"), photo("b")], [photo("b"), photo("c"), photo("d")]], 3);
    expect(merged.map((p) => p.file)).toEqual(["a", "b", "c"]);
  });
});

describe("helpers", () => {
  it("renders Commons HTML as text", () => {
    expect(plain('<span lang="en">Road &amp; bridge</span>\n <b>offset</b>')).toBe("Road & bridge offset");
    expect(plain(undefined)).toBe("");
  });

  it("asks Commons for files with licence metadata, CORS-open", () => {
    const u = new URL(categoryFilesUrl("2024 Noto earthquake"));
    expect(u.searchParams.get("gcmtitle")).toBe("Category:2024 Noto earthquake");
    expect(u.searchParams.get("iiurlwidth")).toBe(String(THUMB_WIDTH));
    expect(u.searchParams.get("iiextmetadatafilter")).toContain("LicenseShortName");
  });
});
