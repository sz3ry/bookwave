import type {
  DiscoveryChip,
  DiscoveryList,
  DiscoveryPage,
  DiscoverySeries,
  SearchResponse,
} from '../interfaces/books';
import api from '../utils/api';
import { searchResultToAudiotekaEntry } from '../utils/helpers';
import { type BookPageData, type CatalogApi, toSeriesInfo } from './types';

const BASE = '/audioteka';

export const audiotekaCatalog: CatalogApi = {
  provider: 'audioteka',
  search: async (q) =>
    (await api.get<SearchResponse>(`${BASE}/search?q=${encodeURIComponent(q)}`)).data?.results ||
    [],
  chips: async () => (await api.get<DiscoveryChip[]>(`${BASE}/discovery/chips`)).data,
  page: async (slug, token) => {
    const query = token ? `?nextPageToken=${encodeURIComponent(token)}` : '';
    return (
      await api.get<DiscoveryPage>(`${BASE}/discovery/page/${encodeURIComponent(slug)}${query}`)
    ).data;
  },
  list: async (itemsUrl, token) => {
    const params = new URLSearchParams({ url: itemsUrl });
    if (token) params.set('nextPageToken', token);
    return (await api.get<DiscoveryList>(`${BASE}/discovery/list?${params}`)).data;
  },
  // Audioteka picks the next part by the current book's id, not its order number.
  series: async (id, current) => {
    const query = current.bookId ? `?current=${encodeURIComponent(current.bookId)}` : '';
    return (
      await api.get<DiscoverySeries>(`${BASE}/discovery/series/${encodeURIComponent(id)}${query}`)
    ).data;
  },
  seriesInfo: async (id) =>
    toSeriesInfo(
      (await api.get(`${BASE}/book-details/${encodeURIComponent(id)}`)).data?.book?.seriesInfo,
    ),
  bookPage: async (id) =>
    (await api.get<BookPageData>(`${BASE}/book-details/${encodeURIComponent(id)}`)).data,
  addToLibrary: async (id) => {
    await api.post(`${BASE}/library/add`, { id });
  },
  removeFromLibrary: async (id) => {
    await api.post(`${BASE}/library/remove`, { id });
  },
  playTarget: (book) => ({
    path: `/player/audioteka/${book.id}`,
    state: { audiotekaBook: searchResultToAudiotekaEntry(book), autoPlay: true },
  }),
  authorTarget: (author) =>
    author.id
      ? { kind: 'list', itemsUrl: `author:${author.id}`, title: author.name }
      : { kind: 'search', query: author.name },
};
