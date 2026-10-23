import type {
  DiscoveryChip,
  DiscoveryList,
  DiscoveryPage,
  DiscoverySeries,
  SearchResultBook,
  SeriesInfo,
} from '../interfaces/books';
import type { ProviderId } from '../interfaces/library';

/**
 * The book a series view is opened from. Storytel picks the next part by the
 * order number, Audioteka by the book id; each catalog reads the one it needs.
 */
export interface SeriesCurrent {
  order: number | null;
  bookId: string;
}

export type AuthorTarget =
  | { kind: 'list'; itemsUrl: string; title: string }
  | { kind: 'search'; query: string };

/** Everything the book page shows about one book. */
export interface BookPageData {
  book: SearchResultBook;
  inLibrary: boolean;
  // The library entry can be removed from Bookwave.
  removable: boolean;
  // "After this book" recommendations; empty where the service has none.
  recommendedAfter: SearchResultBook[];
}

/** The active service's catalogue: search, Discover, series and library edits. */
export interface CatalogApi {
  provider: ProviderId;
  search(q: string): Promise<SearchResultBook[]>;
  chips(): Promise<DiscoveryChip[]>;
  page(slug: string, token?: string): Promise<DiscoveryPage>;
  list(itemsUrl: string, token?: string): Promise<DiscoveryList>;
  series(id: string, current: SeriesCurrent): Promise<DiscoverySeries>;
  seriesInfo(id: string): Promise<SeriesInfo | null>;
  bookPage(id: string): Promise<BookPageData>;
  addToLibrary(id: string): Promise<void>;
  removeFromLibrary(id: string): Promise<void>;
  playTarget(book: SearchResultBook): { path: string; state: unknown };
  authorTarget(author: { id?: string; name: string }): AuthorTarget;
}

/** Normalises a raw `seriesInfo` object; null when it names no series. */
export const toSeriesInfo = (raw: any): SeriesInfo | null => {
  if (!raw?.id) return null;
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    orderInSeries: typeof raw.orderInSeries === 'number' ? raw.orderInSeries : null,
  };
};
