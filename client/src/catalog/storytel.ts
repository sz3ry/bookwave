import type { SearchResponse, SearchResultBook } from '../interfaces/books';
import api, {
  getDiscoveryChips,
  getDiscoveryList,
  getDiscoveryPage,
  getDiscoverySeries,
} from '../utils/api';
import { searchResultToBookEntity } from '../utils/helpers';
import { type BookPageData, type CatalogApi, toSeriesInfo } from './types';

const names = (people: any): string =>
  (Array.isArray(people) ? people : []).map((p: any) => p?.name ?? '').join(', ');

/** Storytel `book-details` reply as a book page; it says nothing about the bookshelf. */
async function bookPage(id: string): Promise<BookPageData> {
  const data: any = (await api.get(`/book-details/${encodeURIComponent(id)}`)).data || {};
  const formats: any[] = Array.isArray(data.formats) ? data.formats : [];
  const abook = formats.find((f) => f?.type === 'abook');
  const ebook = formats.find((f) => f?.type === 'ebook');
  const seriesInfo = toSeriesInfo(data.seriesInfo);
  const authors: any[] = Array.isArray(data.authors) ? data.authors : [];
  const book: SearchResultBook = {
    id: String(id),
    title: data.title || '',
    authors: names(authors),
    narrators: names(data.narrators),
    coverUrl: abook?.cover?.url || ebook?.cover?.url || data.cover?.url || '',
    category: data.category?.name || '',
    durationMs: abook?.durationInMilliseconds || 0,
    description: data.description || '',
    hasAbook: !!abook,
    hasEbook: !!ebook,
    language: data.language || '',
    ...(seriesInfo ? { seriesInfo } : {}),
    authorRefs: authors
      .filter((a) => a?.name)
      .map((a) => ({ id: a.id != null ? String(a.id) : '', name: String(a.name) })),
  };
  return { book, inLibrary: false, removable: false, recommendedAfter: [] };
}

export const storytelCatalog: CatalogApi = {
  provider: 'storytel',
  search: async (q) =>
    (await api.get<SearchResponse>(`/search?q=${encodeURIComponent(q)}`)).data?.results || [],
  chips: getDiscoveryChips,
  page: getDiscoveryPage,
  list: getDiscoveryList,
  series: (id, current) => getDiscoverySeries(id, current.order),
  seriesInfo: async (id) => (await bookPage(id)).book.seriesInfo ?? null,
  bookPage,
  addToLibrary: async (id) => {
    await api.post('/bookshelf/add', { consumableId: id });
  },
  removeFromLibrary: async (id) => {
    await api.post('/bookshelf/remove', { consumableId: id });
  },
  playTarget: (book) => ({
    path: `/player/${book.id}`,
    state: { book: searchResultToBookEntity(book), autoPlay: true },
  }),
  // Bookwave has no Storytel author list: an author opens a search instead.
  authorTarget: (author) => ({ kind: 'search', query: author.name }),
};
