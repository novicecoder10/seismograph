import {
  WIKIMEDIA_USER_AGENT,
  categoryFilesUrl,
  commonsCategoryUrl,
  filesUrl,
  interleave,
  mergePhotos,
  parseItems,
  parsePhotos,
  parseSubcategories,
  pickItem,
  sparqlQuery,
  subcategoriesUrl,
  type EventPhotos,
  type Photo,
} from "../photos/wikimedia";

export interface PhotoRepository {
  /** Photographs of the earthquake an event is, or null when it has no
   *  Wikidata item, nothing is filed, or a service is unreachable. Never
   *  throws: photographs are an addition to a page, never a condition of it. */
  forEvent(lat: number, lon: number, timeMs: number): Promise<EventPhotos | null>;
}

export interface WikimediaPhotoOptions {
  fetchImpl?: typeof fetch;
  /** Items and categories change slowly; a day is fresh enough. */
  revalidateSeconds?: number;
  timeoutMs?: number;
}

const SUBCATEGORIES = 6;

export function createWikimediaPhotoRepository(
  opts: WikimediaPhotoOptions = {},
): PhotoRepository & { lastError: () => string | null } {
  const doFetch = opts.fetchImpl ?? fetch;
  let lastError: string | null = null;

  async function json(url: string): Promise<unknown> {
    const res = await doFetch(url, {
      headers: { "User-Agent": WIKIMEDIA_USER_AGENT, Accept: "application/json, application/sparql-results+json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      next: { revalidate: opts.revalidateSeconds ?? 86_400 },
    } as RequestInit);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
  }

  /** A failed category costs its photographs, not the others'. */
  async function photosIn(url: string): Promise<Photo[]> {
    try {
      return parsePhotos(await json(url));
    } catch (e) {
      lastError = String(e);
      return [];
    }
  }

  return {
    lastError: () => lastError,

    async forEvent(lat, lon, timeMs) {
      lastError = null;
      try {
        const sparql = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparqlQuery(lat, lon, timeMs))}`;
        const item = pickItem(parseItems(await json(sparql)), timeMs);
        if (item === null) return null;

        // Commons usually names a category after the item even when Wikidata
        // does not link it; a missing category just returns no files.
        const category = item.category ?? item.label;
        // Large events file most photographs one level down, by place or day,
        // so the subcategory list is fetched alongside the top level, and the
        // levels are interleaved so no one of them fills the gallery.
        const [own, top, subs] = await Promise.all([
          item.images.length > 0 ? photosIn(filesUrl(item.images)) : Promise.resolve([]),
          photosIn(categoryFilesUrl(category)),
          json(subcategoriesUrl(category)).then(parseSubcategories, () => [] as string[]),
        ]);
        const below = await Promise.all(subs.slice(0, SUBCATEGORIES).map((c) => photosIn(categoryFilesUrl(c))));
        const groups = [own, interleave([top, ...below])];
        const photos = mergePhotos(groups);
        if (photos.length === 0) return null;
        return {
          subject: {
            label: item.label,
            wikidataUrl: item.id.replace(/^http:/, "https:"),
            articleUrl: item.articleUrl,
            categoryUrl: top.length > 0 || subs.length > 0 ? commonsCategoryUrl(category) : null,
          },
          photos,
        };
      } catch (e) {
        lastError = String(e);
        return null;
      }
    },
  };
}
