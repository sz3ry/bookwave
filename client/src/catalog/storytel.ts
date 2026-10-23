import type { SearchResponse } from '../interfaces/books';
import api, {
  getDiscoveryChips,
  getDiscoveryList,
  getDiscoveryPage,
  getDiscoverySeries,
} from '../utils/api';
import { searchResultToBookEntity } from '../utils/helpers';
import { type CatalogApi, toSeriesInfo } from './types';

export const storytelCatalog: CatalogApi = {
  provider: 'storytel',
  search: async (q) =>
    (await api.get<SearchResponse>(`/search?q=${encodeURIComponent(q)}`)).data?.results || [],
  chips: getDiscoveryChips,
  page: getDiscoveryPage,
  list: getDiscoveryList,
  series: (id, current) => getDiscoverySeries(id, current.order),
  seriesInfo: async (id) =>
    toSeriesInfo((await api.get(`/book-details/${encodeURIComponent(id)}`)).data?.seriesInfo),
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
