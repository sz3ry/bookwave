import { appLogger } from '../logger';
import type { FetchLike } from '../http';
import { CACHE_TTL_MS, createTtlCache } from '../cache';
import {
  type CatalogBook,
  type DiscoveryList,
  type DiscoveryRow,
  type DiscoverySeries,
  embeddedList,
  toCatalogBooks,
  toHomeRows,
  toProductBook,
  toSeries,
} from './catalog';
import {
  type AudiotekaBook,
  type AudiotekaLibraryEntry,
  type AudiotekaRemotePosition,
  type AudiotekaTrack,
  embeddedItems,
  isListenable,
  mergeLibrary,
  toAudiotekaBook,
  toRemotePosition,
  toTimeline,
} from './mapping';
import { searchAlgolia } from './search';

const API_BASE = 'https://api-audioteka.audioteka.com';
const FALLBACK_APP_VERSION = '3.55.0';
const DEVICE_NAME = 'Bookwave';
const REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;
const LICENSE_CONCURRENCY = 4;
const LIST_QUERY = '?page=1&limit=100';
const LIST_PAGE_SIZE = 20;
const CYCLE_QUERY = 'page=1&limit=100';

export interface AudiotekaCredentials {
  deviceId: string;
  refreshId: string;
  token: string | null;
  expiresAt: string | null;
}

// The refresh id was rejected: the session is over and the user must log in again.
export class AudiotekaUnauthorizedError extends Error {
  readonly isAudiotekaUnauthorized = true;

  constructor(message = 'Audioteka session expired') {
    super(message);
    this.name = 'AudiotekaUnauthorizedError';
  }
}

export class AudiotekaHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AudiotekaHttpError';
    this.status = status;
  }
}

export interface AudiotekaClientOptions {
  credentials: AudiotekaCredentials;
  fetch?: FetchLike;
  now?: () => number;
  onCredentialsChanged: (credentials: AudiotekaCredentials) => void;
  onCredentialsRejected: () => void;
}

interface RequestOptions {
  body?: Record<string, unknown>;
  auth?: boolean;
  // Statuses returned to the caller instead of thrown.
  allowStatus?: number[];
}

interface ApiResponse {
  status: number;
  data: unknown;
}

export interface AudiotekaBookPage {
  book: CatalogBook;
  // In favourites, on the shelf or recently played.
  inLibrary: boolean;
  // Only favourites can be removed from the library.
  removable: boolean;
  recommendedAfter: CatalogBook[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const facetFilters = (facets: unknown): string[] =>
  (Array.isArray(facets) ? facets : []).flatMap((facet) =>
    isRecord(facet) && typeof facet.name === 'string' && typeof facet.value === 'string'
      ? [`${facet.name}:'${facet.value}'`]
      : [],
  );

const containsId = (list: unknown, id: string): boolean =>
  embeddedItems(list).some((item) => isRecord(item) && item.id === id);

export class AudiotekaClient {
  private credentials: AudiotekaCredentials;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly onCredentialsChanged: (credentials: AudiotekaCredentials) => void;
  private readonly onCredentialsRejected: () => void;
  private refreshing: Promise<void> | null = null;
  private userAgent: Promise<string> | null = null;
  private catalogId: Promise<string> | null = null;
  // Catalogue responses by path (home screen, lists, cycles, recommendations,
  // search settings). Lives and dies with this client, so another account
  // never sees them.
  private catalogCache = createTtlCache<unknown>(CACHE_TTL_MS);

  constructor(opts: AudiotekaClientOptions) {
    this.credentials = { ...opts.credentials };
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.onCredentialsChanged = opts.onCredentialsChanged;
    this.onCredentialsRejected = opts.onCredentialsRejected;
  }

  // Concurrent callers share one in-flight refresh.
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async getLibrary(): Promise<AudiotekaLibraryEntry[]> {
    const [recent, favourites, shelf, positions] = await Promise.all([
      this.get(`/v2/me/recently-played${LIST_QUERY}`),
      this.get(`/v2/me/favourites${LIST_QUERY}`),
      this.get(`/v2/me/shelf${LIST_QUERY}`),
      this.get(`/v2/me/playback-progress${LIST_QUERY}`),
    ]);
    const entries = mergeLibrary({ recent, favourites, shelf }, positions);

    let next = 0;
    const worker = async () => {
      while (next < entries.length) {
        const entry = entries[next++];
        try {
          const channels = await this.get(
            `/v2/me/audiobook-license-channels/${encodeURIComponent(entry.id)}`,
          );
          entry.available = isListenable(channels);
        } catch {
          // Fail open: an unknown license state must not hide the book.
          entry.available = true;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(LICENSE_CONCURRENCY, entries.length) }, worker),
    );
    return entries;
  }

  async getBook(id: string): Promise<AudiotekaBook> {
    const book = toAudiotekaBook(await this.get(`/v2/audiobooks/${encodeURIComponent(id)}`));
    if (!book) throw new Error(`Audioteka returned an unreadable audiobook ${id}`);
    return book;
  }

  async getTimeline(id: string): Promise<AudiotekaTrack[]> {
    return toTimeline(await this.get(`/v2/audiobooks/${encodeURIComponent(id)}/tracks`));
  }

  async getTrackUrl(trackId: string): Promise<{ url: string; expiresAt: number }> {
    const data = await this.get(`/v2/tracks/${encodeURIComponent(trackId)}/stream`);
    if (!isRecord(data) || typeof data.url !== 'string' || !data.url) {
      throw new Error(`Audioteka returned no stream URL for track ${trackId}`);
    }
    const lifetime =
      typeof data.lifetime_in_seconds === 'number' && Number.isFinite(data.lifetime_in_seconds)
        ? data.lifetime_in_seconds
        : 0;
    return { url: data.url, expiresAt: this.now() + lifetime * 1000 };
  }

  async getPosition(id: string): Promise<AudiotekaRemotePosition | null> {
    const res = await this.request('GET', `/v2/me/playback-progress/${encodeURIComponent(id)}`, {
      allowStatus: [404],
    });
    return res.status === 404 ? null : toRemotePosition(res.data);
  }

  async savePosition(id: string, positionMs: number): Promise<void> {
    await this.command({
      name: 'SavePlaybackProgress',
      audiobook_id: id,
      position: Math.round(positionMs),
      device: DEVICE_NAME,
    });
  }

  async startPlayback(id: string): Promise<void> {
    await this.command({ name: 'StartPlayback', audiobook_id: id });
  }

  async getHomeRows(): Promise<DiscoveryRow[]> {
    return toHomeRows(await this.cachedGet('/v2/me/screen'));
  }

  // `author:<id>` pages an author's books. Home rows (`section:<id>`) have no
  // list behind them: their section endpoint only repeats the row's items.
  async getList(itemsUrl: string, page: number): Promise<DiscoveryList> {
    const pageNumber = Number.isInteger(page) && page >= 1 ? page : 1;
    if (itemsUrl.startsWith('author:')) {
      const authorId = itemsUrl.slice('author:'.length);
      if (!authorId) throw new AudiotekaHttpError('Audioteka list has no author id', 400);
      const catalog = await this.getCatalogId();
      const data = await this.cachedGet(
        `/v2/authors/${encodeURIComponent(authorId)}/products?catalog=${encodeURIComponent(catalog)}&page=${pageNumber}&limit=${LIST_PAGE_SIZE}`,
      );
      const products = embeddedList(data, 'app:product');
      const pages = isRecord(data) && typeof data.pages === 'number' ? data.pages : pageNumber;
      const total = isRecord(data) && typeof data.total === 'number' ? data.total : 0;
      // The products list carries no author entity; take the name from a book.
      const title =
        products
          .flatMap((product) => toProductBook(product)?.authorRefs ?? [])
          .find((ref) => ref.id === authorId)?.name ?? '';
      return {
        title,
        totalCount: total,
        items: toCatalogBooks(products),
        nextPageToken: pageNumber < pages ? String(pageNumber + 1) : null,
      };
    }
    if (itemsUrl.startsWith('section:')) {
      throw new AudiotekaHttpError('Audioteka home rows have no full list', 404);
    }
    throw new AudiotekaHttpError(`Unknown Audioteka list ${itemsUrl}`, 400);
  }

  async search(query: string): Promise<CatalogBook[]> {
    const text = query.trim();
    if (!text) return [];
    const settings = await this.cachedGet('/v2/me/algolia');
    if (!isRecord(settings) || typeof settings.index !== 'string' || !settings.index) {
      throw new Error('Audioteka returned no search index');
    }
    const filters = [
      ...facetFilters(settings.restrict_facets),
      ...facetFilters(settings.select_facets),
    ].join(' AND ');
    return toCatalogBooks(
      await searchAlgolia(text, { index: settings.index, filters }, this.fetchImpl),
    );
  }

  async getBookPage(id: string): Promise<AudiotekaBookPage> {
    const encoded = encodeURIComponent(id);
    const [detail, favourites, shelf, recent, recommended] = await Promise.all([
      this.get(`/v2/audiobooks/${encoded}`),
      this.get(`/v2/me/favourites${LIST_QUERY}`),
      this.get(`/v2/me/shelf${LIST_QUERY}`),
      this.get(`/v2/me/recently-played${LIST_QUERY}`),
      // Recommendations are extra: a failure leaves the list empty.
      this.cachedGet(`/v2/me/recommended-after/${encoded}`).catch(() => null),
    ]);
    const book = toProductBook(detail);
    if (!book || !isRecord(detail)) {
      throw new Error(`Audioteka returned an unreadable audiobook ${id}`);
    }
    const description = typeof detail.description === 'string' ? detail.description : '';
    if (description) book.description = description;
    const category = embeddedList(detail, 'app:category')[0];
    if (isRecord(category) && typeof category.name === 'string' && category.name) {
      book.category = category.name;
    }
    const series = embeddedList(detail, 'app:contained-in').find(
      (cycle) => isRecord(cycle) && cycle.cycle_type === 'series' && typeof cycle.id === 'string',
    );
    if (isRecord(series) && typeof series.id === 'string') {
      book.seriesInfo = {
        id: series.id,
        name: typeof series.name === 'string' ? series.name : '',
        orderInSeries: await this.orderInCycle(series.id, id),
      };
    }
    const removable = containsId(favourites, id);
    return {
      book,
      inLibrary: removable || containsId(shelf, id) || containsId(recent, id),
      removable,
      recommendedAfter: toCatalogBooks(embeddedList(recommended, 'app:product')),
    };
  }

  async getSeries(cycleId: string, currentId?: string): Promise<DiscoverySeries | null> {
    const catalog = encodeURIComponent(await this.getCatalogId());
    const encoded = encodeURIComponent(cycleId);
    const [cycle, products] = await Promise.all([
      this.cachedGet(`/v2/cycles/${encoded}?catalog=${catalog}`),
      this.cachedGet(`/v2/cycles/${encoded}/products?catalog=${catalog}&${CYCLE_QUERY}`),
    ]);
    return toSeries(cycle, embeddedList(products, 'app:product'), currentId);
  }

  async addToLibrary(id: string): Promise<void> {
    await this.command({ name: 'AddToFavourites', product_id: id });
  }

  async removeFromLibrary(id: string): Promise<void> {
    await this.command({ name: 'RemoveFromFavourites', product_id: id });
  }

  // 1-based position of a book in a series cycle; null when it cannot be read.
  private async orderInCycle(cycleId: string, bookId: string): Promise<number | null> {
    try {
      const catalog = encodeURIComponent(await this.getCatalogId());
      const products = await this.cachedGet(
        `/v2/cycles/${encodeURIComponent(cycleId)}/products?catalog=${catalog}&${CYCLE_QUERY}`,
      );
      const index = embeddedList(products, 'app:product').findIndex(
        (product) => isRecord(product) && product.id === bookId,
      );
      return index === -1 ? null : index + 1;
    } catch {
      return null;
    }
  }

  // The account's catalogue id, needed by author and cycle endpoints.
  private getCatalogId(): Promise<string> {
    if (!this.catalogId) {
      this.catalogId = this.get('/v2/me').then((me) => {
        if (!isRecord(me) || typeof me.catalog !== 'string' || !me.catalog) {
          throw new Error('Audioteka returned no catalogue id');
        }
        return me.catalog;
      });
      // A failed lookup is retried on the next call.
      this.catalogId.catch(() => {
        this.catalogId = null;
      });
    }
    return this.catalogId;
  }

  private async cachedGet(path: string): Promise<unknown> {
    const cached = this.catalogCache.get(path);
    if (cached !== undefined) return cached;
    const data = await this.get(path);
    this.catalogCache.set(path, data);
    return data;
  }

  private async command(body: Record<string, unknown>): Promise<void> {
    await this.request('POST', '/v2/commands', { body });
  }

  private async get(path: string): Promise<unknown> {
    return (await this.request('GET', path)).data;
  }

  private needsRefresh(): boolean {
    const { token, expiresAt } = this.credentials;
    if (!token) return true;
    if (!expiresAt) return false;
    const expiry = Date.parse(expiresAt);
    return Number.isFinite(expiry) && expiry - this.now() < REFRESH_MARGIN_MS;
  }

  private async doRefresh(): Promise<void> {
    const res = await this.send('POST', '/v2/commands', {
      auth: false,
      body: {
        name: 'RefreshToken',
        refresh_id: this.credentials.refreshId,
        device_id: this.credentials.deviceId,
      },
    });
    if (res.status >= 400 && res.status < 500) {
      this.onCredentialsRejected();
      throw new AudiotekaUnauthorizedError();
    }
    if (res.status >= 400) {
      throw new AudiotekaHttpError(`Audioteka token refresh failed (${res.status})`, res.status);
    }
    const data = res.data;
    if (
      !isRecord(data) ||
      typeof data.token !== 'string' ||
      typeof data.refresh_id !== 'string' ||
      !data.token ||
      !data.refresh_id
    ) {
      throw new Error('Audioteka token refresh returned an unexpected reply');
    }
    this.credentials = {
      ...this.credentials,
      token: data.token,
      refreshId: data.refresh_id,
      expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
    };
    // Persist the rotated refresh id before anything uses the new token.
    this.onCredentialsChanged({ ...this.credentials });
  }

  // Authorised request: refreshes an expiring token first and retries once after a 401.
  private async request(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<ApiResponse> {
    if (this.needsRefresh()) await this.refresh();
    const tokenUsed = this.credentials.token;
    let res = await this.send(method, path, opts);
    if (res.status === 401) {
      // Another caller may already have replaced the rejected token.
      if (this.credentials.token === tokenUsed) await this.refresh();
      res = await this.send(method, path, opts);
    }
    if (res.status >= 400 && !opts.allowStatus?.includes(res.status)) {
      throw new AudiotekaHttpError(`Audioteka request failed (${res.status}) ${path}`, res.status);
    }
    return res;
  }

  private getUserAgent(): Promise<string> {
    if (!this.userAgent) {
      this.userAgent = this.loadAppVersion().then(
        (version) => `Audioteka/${version} (3550) Android/14 (Phone;Pixel 8)`,
      );
    }
    return this.userAgent;
  }

  private async loadAppVersion(): Promise<string> {
    try {
      const res = await this.fetchImpl(`${API_BASE}/v2/apps/config/android`);
      if (!res.ok) return FALLBACK_APP_VERSION;
      const data: unknown = await res.json();
      const config = isRecord(data) ? data.app_version_config : null;
      const version = isRecord(config) ? config.current_version : null;
      return typeof version === 'string' && version ? version : FALLBACK_APP_VERSION;
    } catch {
      return FALLBACK_APP_VERSION;
    }
  }

  private async send(method: string, path: string, opts: RequestOptions): Promise<ApiResponse> {
    const headers: Record<string, string> = {
      'user-agent': await this.getUserAgent(),
      accept: 'application/json',
    };
    if (opts.auth !== false && this.credentials.token) {
      headers.authorization = `Bearer ${this.credentials.token}`;
    }
    const body = opts.body ? JSON.stringify(opts.body) : undefined;
    if (body) headers['content-type'] = 'application/json';

    appLogger.add({
      type: 'http_request',
      message: `[${method}] ${path}`,
      method,
      url: path,
      data: opts.body,
    });

    let res: Response;
    try {
      res = await this.fetchImpl(`${API_BASE}${path}`, { method, headers, body });
    } catch (error) {
      appLogger.add({
        type: 'error',
        message: `[Error N/A] ${path}`,
        method,
        url: path,
        data: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    appLogger.add({
      type: res.status >= 400 ? 'error' : 'http_response',
      message: `[${res.status >= 400 ? `Error ${res.status}` : res.status}] ${path}`,
      status: res.status,
      method,
      url: path,
      // Success bodies carry tokens and signed URLs; keep them out of the log.
      data: res.status >= 400 && opts.auth !== false ? data : undefined,
    });
    return { status: res.status, data };
  }
}
