// Audioteka's apps and web site search through Algolia. `/v2/products`
// ignores any text parameter, so Bookwave queries the same index.
//
// The application id and search-only key are public constants of the
// audioteka.com web bundle (the `_next/static/chunks` file that calls
// `initIndex`), copied here by hand. Audioteka may rotate them at any time: a
// rejected key surfaces as AudiotekaSearchUnavailableError ("search
// unavailable") and the rest of the app keeps working. To update, copy the two
// strings passed to the Algolia client factory in that chunk. Never scrape the
// site at runtime and never ship these values to the renderer.
import type { FetchLike } from '../http';

export const ALGOLIA_APP_ID = 'E3AUN1PXHJ';
export const ALGOLIA_SEARCH_KEY = 'd77118f56cd5ae59a3701fd6e03a0bcf';

const HITS_PER_PAGE = 50;

export class AudiotekaSearchUnavailableError extends Error {
  constructor(message = 'Audioteka search is unavailable') {
    super(message);
    this.name = 'AudiotekaSearchUnavailableError';
  }
}

export interface AlgoliaConfig {
  index: string;
  filters: string;
}

export async function searchAlgolia(
  query: string,
  config: AlgoliaConfig,
  fetchImpl: FetchLike,
): Promise<unknown[]> {
  const url = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/${encodeURIComponent(config.index)}/query`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'x-algolia-application-id': ALGOLIA_APP_ID,
      'x-algolia-api-key': ALGOLIA_SEARCH_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query, filters: config.filters, hitsPerPage: HITS_PER_PAGE }),
  });
  if (res.status === 401 || res.status === 403) throw new AudiotekaSearchUnavailableError();
  if (!res.ok) throw new Error(`Audioteka search failed (${res.status})`);
  const data: unknown = await res.json();
  const hits =
    typeof data === 'object' && data !== null ? (data as { hits?: unknown }).hits : undefined;
  return Array.isArray(hits) ? hits : [];
}
