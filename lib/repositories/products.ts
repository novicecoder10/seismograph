import { detailUrl, parseProducts, type EventProducts } from "../events/products";

export interface ProductRepository {
  readonly name: string;
  /** The product tree for an event, or null when the detail feed is
   *  unreachable. Never throws: an event page must still render its origin. */
  byEvent(sourceId: string): Promise<EventProducts | null>;
}

export interface UsgsProductOptions {
  fetchImpl?: typeof fetch;
  /** Seconds the fetched detail may be cached. Products are revised for hours
   *  after an event, so this is short. */
  revalidateSeconds?: number;
}

export function createUsgsProductRepository(
  opts: UsgsProductOptions = {},
): ProductRepository & { lastError: () => string | null } {
  const doFetch = opts.fetchImpl ?? fetch;
  let lastError: string | null = null;

  return {
    name: "usgs-detail",
    lastError: () => lastError,

    async byEvent(sourceId) {
      lastError = null;
      try {
        const res = await doFetch(detailUrl(sourceId), {
          next: { revalidate: opts.revalidateSeconds ?? 300 },
        } as RequestInit);
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          return null;
        }
        return parseProducts(await res.json());
      } catch (e) {
        lastError = String(e);
        return null;
      }
    },
  };
}
