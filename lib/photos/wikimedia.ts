/** Photographs of notable earthquakes, from Wikidata and Wikimedia Commons.
 *
 *  Wikidata says which earthquake an event is (a Q7944 item near the epicentre
 *  on the same dates) and where its photographs are filed on Commons (P373 or
 *  the Commons sitelink); Commons says who took each one and under which
 *  licence. Both are free, keyless and openly licensed. Most earthquakes have no
 *  item, and then there is nothing to show: the page omits the section. */

export const WIKIMEDIA_USER_AGENT =
  "seismograph/0.1 (https://github.com/novicecoder10/seismograph)";

const DAY_MS = 86_400_000;
/** Wikidata coordinates are editors' epicentres, often rounded. */
export const SEARCH_RADIUS_KM = 250;
/** Commons only serves thumbnails at standard widths (500, 960, 1280, 1920);
 *  any other width is refused with HTTP 400. */
export const THUMB_WIDTH = 500;
export const FULL_WIDTH = 1280;
export const MAX_PHOTOS = 12;

export interface EarthquakeItem {
  /** Wikidata entity URL. */
  id: string;
  label: string;
  /** Point in time (P585), or start time (P580) for a sequence. */
  startMs: number;
  /** End time (P582), when the item is a sequence. */
  endMs: number | null;
  distanceKm: number;
  /** Commons category name, without the "Category:" prefix. */
  category: string | null;
  /** Commons file names (without "File:") from P18. */
  images: string[];
  articleUrl: string | null;
}

export interface Photo {
  /** File name, without "File:". */
  file: string;
  pageUrl: string;
  thumbUrl: string;
  fullUrl: string;
  /** Aspect ratio of the original, width / height. */
  aspect: number;
  description: string;
  artist: string;
  license: string;
  licenseUrl: string | null;
  taken: string | null;
}

export interface EventPhotos {
  subject: {
    label: string;
    wikidataUrl: string;
    articleUrl: string | null;
    categoryUrl: string | null;
  };
  photos: Photo[];
}

/** Wikidata day-precision dates are midnight of a local or UTC date, and a
 *  sequence's start (P580) can precede its largest shock by days, so the window
 *  runs from three days before the event to one after. Dates are filtered first
 *  and distance second: a radius search over a populated region touches tens of
 *  thousands of items and takes ten seconds, the date range about one. */
export function sparqlQuery(lat: number, lon: number, timeMs: number): string {
  const lo = new Date(timeMs - 3 * DAY_MS).toISOString().replace(/\.\d+Z$/, "Z");
  const hi = new Date(timeMs + DAY_MS).toISOString().replace(/\.\d+Z$/, "Z");
  return `SELECT ?q ?qLabel ?when ?start ?end ?dist ?image ?cat ?commons ?topicCommons ?article WHERE {
  { ?q wdt:P585 ?t0 } UNION { ?q wdt:P580 ?t0 }
  FILTER(?t0 >= "${lo}"^^xsd:dateTime && ?t0 <= "${hi}"^^xsd:dateTime)
  ?q wdt:P31/wdt:P279* wd:Q7944.
  ?q wdt:P625 ?c.
  BIND(geof:distance(?c, "Point(${lon.toFixed(4)} ${lat.toFixed(4)})"^^geo:wktLiteral) AS ?dist)
  FILTER(?dist <= ${SEARCH_RADIUS_KM})
  OPTIONAL { ?q wdt:P585 ?when }
  OPTIONAL { ?q wdt:P580 ?start }
  OPTIONAL { ?q wdt:P582 ?end }
  OPTIONAL { ?q wdt:P18 ?image }
  OPTIONAL { ?q wdt:P373 ?cat }
  OPTIONAL { ?commons schema:about ?q; schema:isPartOf <https://commons.wikimedia.org/> }
  OPTIONAL { ?q wdt:P910 ?topic. ?topicCommons schema:about ?topic; schema:isPartOf <https://commons.wikimedia.org/> }
  OPTIONAL { ?article schema:about ?q; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`;
}

interface Binding {
  [k: string]: { value: string } | undefined;
}

/** Folds SPARQL rows (one per image × sitelink) into items. */
export function parseItems(json: unknown): EarthquakeItem[] {
  const rows = (json as { results?: { bindings?: Binding[] } })?.results?.bindings;
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, EarthquakeItem>();
  for (const r of rows) {
    const id = r.q?.value;
    const t0 = Date.parse(r.when?.value ?? r.start?.value ?? "");
    if (!id || !Number.isFinite(t0)) continue;
    let item = byId.get(id);
    if (!item) {
      const end = Date.parse(r.end?.value ?? "");
      item = {
        id,
        label: r.qLabel?.value ?? id.split("/").pop()!,
        startMs: t0,
        endMs: Number.isFinite(end) ? end : null,
        distanceKm: Number(r.dist?.value ?? SEARCH_RADIUS_KM),
        category: null,
        images: [],
        articleUrl: r.article?.value ?? null,
      };
      byId.set(id, item);
    }
    item.category ??= categoryName(r.cat?.value, r.commons?.value ?? r.topicCommons?.value);
    const image = fileFromFilePath(r.image?.value);
    if (image && !item.images.includes(image)) item.images.push(image);
  }
  return [...byId.values()];
}

function categoryName(p373: string | undefined, sitelink: string | undefined): string | null {
  if (p373) return p373;
  const m = sitelink?.match(/\/wiki\/Category:(.+)$/);
  return m?.[1] ? decodeURIComponent(m[1]).replace(/_/g, " ") : null;
}

function fileFromFilePath(url: string | undefined): string | null {
  const m = url?.match(/Special:FilePath\/(.+)$/);
  return m?.[1] ? decodeURIComponent(m[1]).replace(/_/g, " ") : null;
}

/** The item closest in time to the event, then closest in space; a sequence
 *  whose span contains the event counts as zero time away. */
export function pickItem(items: EarthquakeItem[], timeMs: number): EarthquakeItem | null {
  const gap = (it: EarthquakeItem) => {
    const end = it.endMs ?? it.startMs + DAY_MS;
    return timeMs >= it.startMs && timeMs <= end ? 0 : Math.min(Math.abs(timeMs - it.startMs), Math.abs(timeMs - end));
  };
  const usable = [...items];
  usable.sort((a, b) => gap(a) - gap(b) || a.distanceKm - b.distanceKm);
  return usable[0] ?? null;
}

/** Maps, charts and seismograms are filed beside the photographs; so,
 *  occasionally, are pictures of the dead, which a reference page should not
 *  put in front of a reader unasked. */
const NOT_A_PHOTO = /\b(map|maps|shakemap|intensity|isoseismal|chart|graph|diagram|seismogram|logo|locator|location|beachball|mechanism|infographic|comic|cartoon|drawing|illustration|painting|poster|stamp|artwork|document|letter|leaflet|flyer|newspaper|page-\d+)\b/i;
/** Reactions and official visits are portraits and meeting rooms; the gallery
 *  is about the ground and what happened to it. */
const NOT_THE_EARTHQUAKE = /\b(reactions?|politicians?|condolences?|visits?|meetings?|press (conferences?|statements?|releases?)|ceremon(y|ies)|memorials?|concerts?|prime minister|ministers?|president|ambassadors?|embassy)\b/i;
const DISTRESSING = /\b(body|bodies|corpse|corpses|dead|deaths?|victims?|funeral|burial|grave|graves|cadaver)\b/i;

export function commonsCategoryUrl(category: string): string {
  return `https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(category.replace(/ /g, "_"))}`;
}

/** The Commons API URL for the files in a category, with licence metadata. */
export function categoryFilesUrl(category: string): string {
  return commonsApi({
    generator: "categorymembers",
    gcmtitle: `Category:${category}`,
    gcmtype: "file",
    gcmlimit: "50",
    ...IMAGEINFO,
  });
}

/** The Commons API URL for a category's subcategories. */
export function subcategoriesUrl(category: string): string {
  return commonsApi({
    list: "categorymembers",
    cmtitle: `Category:${category}`,
    cmtype: "subcat",
    cmlimit: "50",
  });
}

/** The Commons API URL for named files, with licence metadata. */
export function filesUrl(files: string[]): string {
  return commonsApi({ titles: files.map((f) => `File:${f}`).join("|"), ...IMAGEINFO });
}

const IMAGEINFO = {
  prop: "imageinfo",
  iiprop: "url|mime|size|extmetadata",
  iiurlwidth: String(THUMB_WIDTH),
  iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|ImageDescription|DateTimeOriginal",
};

function commonsApi(params: Record<string, string>): string {
  const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", ...params });
  return `https://commons.wikimedia.org/w/api.php?${q}`;
}

/** Subcategories that show what the earthquake did come first; the rest keep
 *  Commons' order. */
const THE_EARTHQUAKE = /\b(damages?|damaged|destruction|destroyed|collapsed?|ruins?|rubble|rescue|landslides?|tsunami|aftermath|surface rupture|faults?|liquefaction)\b/i;

export function parseSubcategories(json: unknown): string[] {
  const list = (json as { query?: { categorymembers?: { title?: string }[] } })?.query?.categorymembers;
  if (!Array.isArray(list)) return [];
  const names = list.flatMap((c) => {
    const name = c.title?.startsWith("Category:") ? c.title.slice("Category:".length) : null;
    return name === null || NOT_A_PHOTO.test(name) || DISTRESSING.test(name) || NOT_THE_EARTHQUAKE.test(name) ? [] : [name];
  });
  return [...names.filter((n) => THE_EARTHQUAKE.test(n)), ...names.filter((n) => !THE_EARTHQUAKE.test(n))];
}

interface ImageInfo {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  mime?: string;
  width?: number;
  height?: number;
  extmetadata?: Record<string, { value?: unknown } | undefined>;
}

/** Photographs only: JPEGs at least as wide as the grid thumbnail, with a
 *  licence and an author to credit. Order is the API's (alphabetical). */
export function parsePhotos(json: unknown): Photo[] {
  const pages = (json as { query?: { pages?: unknown } })?.query?.pages;
  const list: { title?: string; imageinfo?: ImageInfo[] }[] = Array.isArray(pages)
    ? pages
    : pages && typeof pages === "object"
      ? Object.values(pages)
      : [];
  const out: Photo[] = [];
  for (const p of list) {
    const info = p.imageinfo?.[0];
    const file = p.title?.replace(/^File:/, "");
    if (!info || !file || info.mime !== "image/jpeg") continue;
    if (!info.url || !info.thumburl || !info.descriptionurl || !info.width || !info.height) continue;
    if (info.width < THUMB_WIDTH) continue;
    const meta = info.extmetadata ?? {};
    const description = plain(meta.ImageDescription?.value);
    if (NOT_A_PHOTO.test(file) || NOT_A_PHOTO.test(description)) continue;
    if (DISTRESSING.test(file) || DISTRESSING.test(description)) continue;
    if (NOT_THE_EARTHQUAKE.test(file) || NOT_THE_EARTHQUAKE.test(description)) continue;
    const license = plain(meta.LicenseShortName?.value);
    const artist = plain(meta.Artist?.value);
    if (!license) continue;
    const thumbUrl = stripTracking(info.thumburl);
    out.push({
      file,
      pageUrl: info.descriptionurl,
      thumbUrl,
      fullUrl: info.width > FULL_WIDTH ? thumbUrl.replace(`/${THUMB_WIDTH}px-`, `/${FULL_WIDTH}px-`) : info.url,
      aspect: info.width / info.height,
      description: truncate(description, 240),
      artist: truncate(artist || "Unknown author", 80),
      license,
      licenseUrl: plain(meta.LicenseUrl?.value) || null,
      taken: plain(meta.DateTimeOriginal?.value).slice(0, 10) || null,
    });
  }
  return out;
}

/** Commons metadata is HTML; the page shows it as text. */
export function plain(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

function stripTracking(url: string): string {
  return url.replace(/\?utm_[^#]*$/, "");
}

/** One photographer often uploads dozens of near-identical frames, filed
 *  alphabetically together; a cap keeps the gallery about the earthquake. */
export const MAX_PER_AUTHOR = 2;

/** Pooled photographs, each file once and at most a few per photographer, in
 *  group order (the item's own P18 images first). */
export function mergePhotos(groups: Photo[][], limit = MAX_PHOTOS, perAuthor = MAX_PER_AUTHOR): Photo[] {
  const seen = new Set<string>();
  const byAuthor = new Map<string, number>();
  const out: Photo[] = [];
  for (const g of groups) {
    for (const p of g) {
      if (seen.has(p.file)) continue;
      const n = byAuthor.get(p.artist) ?? 0;
      if (n >= perAuthor) continue;
      seen.add(p.file);
      byAuthor.set(p.artist, n + 1);
      out.push(p);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** One from each list in turn, so no single subcategory crowds out the rest. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]!);
  }
  return out;
}
