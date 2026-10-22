import {
  createStorytelFetch,
  type FetchLike,
  StorytelAuthError,
  StorytelHttpError,
  type StorytelRequest,
  type StorytelResponse,
} from './http/storytelFetch';
import {
  CACHE_TTL_MS,
  createTtlCache,
  type DiscoveryChip,
  type DiscoveryItem,
  type DiscoveryList,
  type DiscoveryPage,
  isAllowedExploreUrl,
  playableOnly,
  type SeriesInfo,
  toDiscoveryList,
  toDiscoveryPage,
  toSeriesInfo,
} from './discovery';
import { encryptPassword } from './passwordCrypt';

export { StorytelAuthError };

interface AccountInfo {
  jwt: string;
  singleSignToken: string;
}

interface LoginData {
  accountInfo: AccountInfo;
}

interface Bookmark {
  id: string;
  position: number;
  note?: string;
}

interface BookmarkResponse {
  bookmarks: Bookmark[];
}

export interface SearchResultBook {
  id: string;
  title: string;
  authors: string;
  narrators: string;
  coverUrl: string;
  category: string;
  durationMs: number;
  description?: string;
  hasAbook: boolean;
  hasEbook: boolean;
  // Announced but not out yet: listed, but cannot be played.
  comingSoon?: boolean;
  releaseDate?: string | null;
  language?: string;
  languageName?: string;
  seriesInfo?: SeriesInfo;
}

// Base URL of the public web search endpoint, per market country. Storytel's own
// site is scoped by `/{country}/{lang}/`, where only the country segment decides
// which catalog answers - except Denmark, which Storytel runs under the Mofibo
// brand on its own host, and which does need the matching language segment.
const WEB_SEARCH_BASE_URLS: Record<string, string> = {
  dk: 'https://mofibo.com/dk/da',
};

const webSearchBaseUrl = (country: string): string =>
  WEB_SEARCH_BASE_URLS[country] ?? `https://www.storytel.com/${country}/${country}`;

// Spreads `seriesInfo` only when Storytel sent a usable series reference.
function seriesField(raw: unknown): { seriesInfo?: SeriesInfo } {
  const info = toSeriesInfo(raw);
  return info ? { seriesInfo: info } : {};
}

// --- Bookshelf ---------------------------------------------------------------

// Raw shape returned by POST https://api.storytel.net/libraries/bookshelf
interface RawBookshelfNamedEntity {
  id: string;
  name: string;
  deepLink?: string;
}

interface RawBookshelfFormat {
  id: string;
  type: 'abook' | 'ebook';
  durationInMilliseconds?: number;
  durationInCharacters?: number;
  cover?: { url: string; width: number; height: number };
  position?: { position: number; updatedTime: string; kidsMode: boolean };
}

interface RawBookshelfModel {
  id: string;
  title: string;
  state: 'CONSUMING' | 'CONSUMED' | 'WILL_CONSUME' | string;
  stateUpdateTime?: string;
  kidsBook?: boolean;
  authors?: RawBookshelfNamedEntity[];
  narrators?: RawBookshelfNamedEntity[];
  formats?: RawBookshelfFormat[];
  category?: { id: number; name: string };
  seriesInfo?: unknown;
}

interface RawBookshelfResponse {
  // Opaque sync cursor. Echoed back on writes so the server can apply the
  // delta against the state the client last saw.
  resourceVersion?: string;
  items?: Record<string, { action: string; model: RawBookshelfModel }>;
  followingItems?: Record<string, unknown>;
  collections?: Record<string, unknown>;
}

// Subset of the legacy BookShelfEntity (client/src/interfaces/books.ts) that
// the frontend actually reads. Keep the keys aligned with that interface so
// the React app keeps working unchanged.
export interface BookShelfEntity {
  id: string;
  status: number;
  // Used by the frontend to sort the library by most recent activity.
  stateUpdateTime?: string;
  positionUpdatedTime?: string;
  book: {
    name: string;
    authorsAsString: string;
    consumableId: string;
    largeCover: string;
    largeCoverE: string;
    category: { title: string };
    language: { localizedName: string };
    seriesInfo?: SeriesInfo;
  };
  abook: {
    id: string;
    narratorAsString: string;
    time: number;
    description: string;
  } | null;
  abookMark: { pos: number } | null;
  ebook: RawBookshelfFormat | null;
}

interface BookShelfResponse {
  books: BookShelfEntity[];
}

interface StorytelClientOptions {
  fetch?: FetchLike;
  // Called when login.action rejects the saved credentials during a token
  // refresh. Not called for network errors or timeouts.
  onCredentialsRejected?: () => void;
}

// the previous HTTP client sent this Accept header on every request that did not set its own;
// keep it so the requests Storytel sees stay unchanged.
const DEFAULT_ACCEPT = 'application/json, text/plain, */*';

const LOGIN_URL = 'https://www.storytel.com/api/login.action';

const EXPLORE_BASE = 'https://api.storytel.net/explore';
const SERIES_MAX_PAGES = 5;
// Lazy rows checked per chip before it is judged to have no audiobooks.
const CHIP_PROBE_ROWS = 3;

// A 4xx other than 401 for one explore row: the row is unavailable for this
// account, not a sign that Storytel is unreachable or the session expired.
function isClientErrorRow(error: unknown): boolean {
  return (
    error instanceof StorytelHttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401
  );
}

const BOOKMARK_ACCEPT = 'application/vnd.storytel.bookmark+json;v=2.0';

function streamLocation(response: StorytelResponse<unknown>): string {
  const location = response.headers.get('location');
  if (!location) throw new Error('Storytel did not return a stream URL');
  return location;
}

class StorytelClient {
  private request: ReturnType<typeof createStorytelFetch>;
  private onCredentialsRejected?: () => void;
  public loginData: LoginData;

  private savedEmail?: string;
  private savedEncryptedPassword?: string;
  // In-flight re-login shared by concurrent requests, so a burst of requests
  // with an expired token sends one login.action, not one each.
  private pendingLogin?: Promise<void>;
  // Explore responses by URL. Lives and dies with this client, so a new
  // login (possibly another market) never sees a previous account's rows.
  private exploreCache = createTtlCache<unknown>(CACHE_TTL_MS);

  constructor(options: StorytelClientOptions = {}) {
    this.request = createStorytelFetch(options.fetch);
    this.onCredentialsRejected = options.onCredentialsRejected;
    this.loginData = {
      accountInfo: {
        jwt: '',
        singleSignToken: '',
      },
    };
  }

  // Sends a Storytel request. With `auth`, adds the api bearer and, when the
  // session turns out to be expired (401), refreshes the login once and
  // retries with the fresh bearer. Login calls are never retried.
  private async send<T = any>(
    req: StorytelRequest,
    opts: { auth: boolean; isLogin?: boolean },
  ): Promise<StorytelResponse<T>> {
    const withHeaders = async (): Promise<StorytelRequest> => ({
      ...req,
      headers: {
        Accept: DEFAULT_ACCEPT,
        ...req.headers,
        ...(opts.auth ? { Authorization: `Bearer ${await this.getApiBearer()}` } : {}),
      },
    });

    // Resolved outside the try: a login rejection while obtaining the bearer
    // must reach the caller as is, never trigger another login attempt.
    const firstAttempt = await withHeaders();
    try {
      return await this.request<T>(firstAttempt);
    } catch (error) {
      if (
        !(error instanceof StorytelAuthError) ||
        error.isLoginFailure ||
        opts.isLogin ||
        // Only bearer requests are retried: URL-token endpoints would resend the stale token.
        !opts.auth ||
        !this.savedEmail ||
        !this.savedEncryptedPassword
      ) {
        throw error;
      }
      try {
        await this.refreshLegacyLogin();
      } catch (refreshError) {
        // A rejected re-login still means "session expired" to the caller;
        // anything else (network, timeout) is reported as it is.
        if (refreshError instanceof StorytelAuthError) throw error;
        throw refreshError;
      }
      return await this.request<T>(await withHeaders());
    }
  }

  setCredentials(email: string, encryptedPassword: string): void {
    this.savedEmail = email.trim();
    this.savedEncryptedPassword = encryptedPassword.trim();
  }

  async refreshLegacyLogin(): Promise<void> {
    if (!this.savedEmail || !this.savedEncryptedPassword) {
      return;
    }
    this.pendingLogin ??= this.loginWith(this.savedEmail, this.savedEncryptedPassword).finally(
      () => {
        this.pendingLogin = undefined;
      },
    );
    return this.pendingLogin;
  }

  // URL-token endpoints carry singleSignToken in the URL and never pass through
  // getApiBearer, so a restored client must log in before building them.
  private async ensureLoggedIn(): Promise<void> {
    const { jwt, singleSignToken } = this.loginData.accountInfo;
    if (!jwt || !singleSignToken) await this.refreshLegacyLogin();
  }

  private async loginWith(email: string, encryptedPassword: string): Promise<void> {
    let response: StorytelResponse<LoginData>;
    try {
      response = await this.send<LoginData>(
        {
          url: LOGIN_URL,
          query: { m: 1, uid: email, pwd: encryptedPassword },
        },
        { auth: false, isLogin: true },
      );
    } catch (error) {
      if (error instanceof StorytelAuthError) this.onCredentialsRejected?.();
      throw error;
    }
    if (response.data?.accountInfo?.jwt) {
      this.loginData = response.data;
    }
  }

  async login(email: string, password: string): Promise<LoginData> {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    const encryptedPassword = encryptPassword(trimmedPassword);
    this.setCredentials(trimmedEmail, encryptedPassword);
    let response: StorytelResponse<LoginData>;
    try {
      response = await this.send<LoginData>(
        {
          url: LOGIN_URL,
          query: { m: 1, uid: trimmedEmail, pwd: encryptedPassword },
        },
        { auth: false, isLogin: true },
      );
    } catch (error: any) {
      if (error.isStorytelUnauthorized) {
        throw error;
      }
      throw new Error(`Login failed: ${error.message}`);
    }
    // A 2xx without a token is not a credential rejection: fail without
    // touching the session so nothing gets persisted.
    if (!response.data?.accountInfo?.jwt) {
      throw new Error('Login failed: Storytel login returned no token');
    }
    this.loginData = response.data;
    return this.loginData;
  }

  // Bearer to send on api.storytel.net/* endpoints: the JWT returned by
  // login.action, renewed automatically.
  private async getApiBearer(): Promise<string> {
    const jwt = this.loginData.accountInfo.jwt;
    if (jwt) {
      try {
        const parts = jwt.split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
          const now = Math.floor(Date.now() / 1000);
          if (payload.exp && payload.exp - 60 <= now) {
            if (this.savedEmail && this.savedEncryptedPassword) {
              await this.refreshLegacyLogin();
              return this.loginData.accountInfo.jwt;
            }
          }
        }
      } catch (error) {
        // Rejected credentials end here; a network error during the proactive
        // refresh falls back to the current jwt.
        if (error instanceof StorytelAuthError && error.isLoginFailure) throw error;
      }
      return jwt;
    }

    if (this.savedEmail && this.savedEncryptedPassword) {
      await this.refreshLegacyLogin();
      return this.loginData.accountInfo.jwt;
    }

    return '';
  }

  // Market country ISO code (e.g. "it", "se", "fi") carried by a Storytel JWT:
  // `store` is shaped like "STHP-IT", with `country`/`countryCode` as fallbacks.
  private countryFromJwt(token?: string | null): string | undefined {
    if (!token) return undefined;
    try {
      const parts = token.split('.');
      if (parts.length < 2) return undefined;
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
      const payload = JSON.parse(payloadJson);
      if (typeof payload.store === 'string') {
        const storeParts = payload.store.split('-');
        const code = storeParts[storeParts.length - 1]?.trim().toLowerCase();
        if (code && /^[a-z]{2}$/.test(code)) {
          return code;
        }
      }
      for (const claim of [payload.country, payload.countryCode]) {
        if (typeof claim === 'string' && /^[a-z]{2}$/i.test(claim.trim())) {
          return claim.trim().toLowerCase();
        }
      }
    } catch {
      // ignore parsing failures
    }
    return undefined;
  }

  // Derive the account's market country from whichever token carries the claim.
  // Taken from the login.action JWT. Returns undefined when no token names a market.
  private async getMarketCountryCode(): Promise<string | undefined> {
    const candidates: (string | null | undefined)[] = [];
    try {
      candidates.push(await this.getApiBearer());
    } catch (error: any) {
      // A failing token refresh must not break search
      console.warn('[storytelApi] could not read api bearer for market lookup:', error.message);
    }
    candidates.push(this.loginData.accountInfo.jwt);

    for (const token of candidates) {
      const code = this.countryFromJwt(token);
      if (code) return code;
    }
    return undefined;
  }

  async getBookmarkPositional(consumableId: string | null = null): Promise<Bookmark[]> {
    const url = `https://api.storytel.net/bookmarks/positional?kidsMode=false&orderBy=updated&orderDirection=desc`;

    try {
      const response = await this.send<{ bookmarks: Bookmark[] }>(
        { url, query: { ...(consumableId && { consumableIds: consumableId }) } },
        { auth: true },
      );
      return response.data.bookmarks;
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      throw new Error(`Failed to get bookmark positional: ${error.message}`);
    }
  }

  async updateBookmarkPositional(
    consumableId: string,
    position: number,
    deviceId: string,
  ): Promise<any> {
    const url = `https://api.storytel.net/bookmarks/positional`;

    try {
      const response = await this.send(
        {
          method: 'POST',
          url,
          body: {
            json: {
              deviceId: deviceId,
              action: 'player_paused',
              secondsSinceCreated: 0,
              position,
              type: 'abook',
              kidsMode: false,
              consumableId: consumableId,
            },
          },
        },
        { auth: true },
      );
      return response.data;
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      throw new Error(`Failed to get bookmark positional: ${error.message}`);
    }
  }

  // /libraries/bookshelf is a delta-sync endpoint: the body carries the client's
  // local changes, the response carries the resulting state plus a
  // `resourceVersion` cursor.
  //
  // Its schema is known from the server's own validation error:
  //   expected=map[string]models.ConsumableActionRequest, field=items
  // so `items` is a map keyed by consumable id. An array body is rejected 400.
  private static readonly BOOKSHELF_URL = 'https://api.storytel.net/libraries/bookshelf';

  // Read the whole bookshelf. Sends an empty body, which the endpoint reads as
  // "no local state, send me everything". Do not "fix" this into a JSON body
  // such as {"items": []} — that is the 400 above.
  private async fetchBookshelfSnapshot(): Promise<RawBookshelfResponse> {
    const response = await this.send<RawBookshelfResponse>(
      {
        method: 'POST',
        url: StorytelClient.BOOKSHELF_URL,
        headers: { Accept: '*/*' },
        body: { form: '' },
      },
      { auth: true },
    );
    return response.data;
  }

  // Push local changes. Must be real JSON: a form-encoded body is discarded by
  // the API without ever failing the request.
  private async postBookshelfDelta(body: Record<string, unknown>): Promise<RawBookshelfResponse> {
    const response = await this.send<RawBookshelfResponse>(
      {
        method: 'POST',
        url: StorytelClient.BOOKSHELF_URL,
        headers: { Accept: '*/*' },
        body: { json: body },
      },
      { auth: true },
    );
    return response.data;
  }

  async getBookshelf(): Promise<BookShelfResponse> {
    try {
      const data = await this.fetchBookshelfSnapshot();

      // The endpoint returns { items: { "<id>": { action, model } } } with a
      // shape that differs from the legacy getBookShelf.action response. Remap
      // each `model` onto the legacy BookShelfEntity keys so the existing
      // frontend keeps working unchanged.
      const items = data?.items;
      if (!items || typeof items !== 'object') return { books: [] };

      // Library state -> legacy numeric status (1 = not started, 2 = in progress,
      // 3 = finished). Dashboard filters use {1,2,3}.
      const stateToStatus: Record<string, number> = {
        WILL_CONSUME: 1,
        CONSUMING: 2,
        CONSUMED: 3,
        FINISHED: 3,
        COMPLETED: 3,
        READING: 2,
        TO_READ: 1,
      };

      const books = Object.values(items)
        .map((entry) => entry?.model)
        .filter(Boolean)
        .map((model): BookShelfEntity => {
          const formats: RawBookshelfFormat[] = Array.isArray(model.formats) ? model.formats : [];
          const abookFormat = formats.find((f) => f.type === 'abook');
          const ebookFormat = formats.find((f) => f.type === 'ebook');
          const coverUrl = abookFormat?.cover?.url ?? ebookFormat?.cover?.url ?? '';
          const join = (arr?: RawBookshelfNamedEntity[]) =>
            (Array.isArray(arr) ? arr : [])
              .map((x) => x?.name)
              .filter(Boolean)
              .join(', ');

          const normalizedState = (model.state || '').toUpperCase();
          let calculatedStatus = stateToStatus[normalizedState];
          if (!calculatedStatus) {
            if (abookFormat?.position?.position && abookFormat.position.position > 0) {
              calculatedStatus = 2;
            } else {
              calculatedStatus = 1;
            }
          }

          return {
            id: model.id,
            status: calculatedStatus,
            stateUpdateTime: model.stateUpdateTime,
            positionUpdatedTime: abookFormat?.position?.updatedTime,
            book: {
              name: model.title,
              authorsAsString: join(model.authors),
              consumableId: String(model.id),
              // Full absolute URL (covers.storytel.com). See note below.
              largeCover: coverUrl,
              largeCoverE: '',
              category: { title: model.category?.name ?? '' },
              language: { localizedName: '' },
              ...seriesField(model.seriesInfo),
            },
            abook: abookFormat
              ? {
                  id: abookFormat.id,
                  narratorAsString: join(model.narrators),
                  // Legacy frontend expects microseconds; API gives ms.
                  time: (abookFormat.durationInMilliseconds ?? 0) * 1000,
                  description: '',
                }
              : null,
            abookMark: abookFormat?.position
              ? { pos: (abookFormat.position.position ?? 0) * 1000 }
              : null,
            ebook: ebookFormat ?? null,
          };
        });

      return { books };
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      console.error(error);
      throw new Error(`Failed to get bookshelf: ${error.message}`);
    }
  }

  private extractLanguageInfo(
    model: any,
    raw?: any,
    item?: any,
  ): { language?: string; languageName?: string } {
    const formats = Array.isArray(model?.formats)
      ? model.formats
      : Array.isArray(raw?.formats)
        ? raw.formats
        : [];

    const formatLang = formats.find((f: any) => f?.language)?.language;

    const langObj =
      model?.language ||
      (Array.isArray(model?.languages) && model.languages[0]) ||
      formatLang ||
      raw?.language ||
      (Array.isArray(raw?.languages) && raw.languages[0]) ||
      item?.language ||
      item?.book?.language;

    if (typeof langObj === 'string') {
      const clean = langObj.toLowerCase().trim();
      return { language: clean };
    }
    if (langObj && typeof langObj === 'object') {
      const iso = (langObj.isoValue || langObj.iso || langObj.code || langObj.id || '')
        .toString()
        .toLowerCase()
        .trim();
      const name = langObj.localizedName || langObj.name || langObj.title || undefined;
      return {
        language: iso || undefined,
        languageName: name,
      };
    }
    return {};
  }

  async searchCatalog(query: string): Promise<SearchResultBook[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const results: SearchResultBook[] = [];
    const seenIds = new Set<string>();

    // 1. Try authenticated api.storytel.net search endpoints first
    // This correctly scopes search results to the logged-in user's country/market
    // and returns all available languages in their catalog (e.g. fi + sv + en).
    try {
      const headers = { Accept: '*/*' };

      const endpoints = [
        `https://api.storytel.net/search/v2?query=${encodeURIComponent(trimmed)}&configVariant=default`,
        `https://api.storytel.net/search/page?query=${encodeURIComponent(trimmed)}&kidsMode=false`,
        `https://api.storytel.net/search?query=${encodeURIComponent(trimmed)}&kidsMode=false`,
      ];

      for (const url of endpoints) {
        try {
          const response = await this.send({ url, headers }, { auth: true });
          const rawItems = Array.isArray(response.data?.items)
            ? response.data.items
            : Array.isArray(response.data?.results)
              ? response.data.results
              : [];

          for (const raw of rawItems) {
            const model = raw.model || raw.item || raw.book || raw;
            const id = String(model.id || model.consumableId || raw.id || raw.consumableId || '');
            const title = model.title || model.name || raw.title || raw.name || '';
            if (!id || !title || seenIds.has(id)) continue;

            const formats: any[] = Array.isArray(model.formats) ? model.formats : [];
            const abook = formats.find((f: any) => f.type === 'abook');
            const ebook = formats.find((f: any) => f.type === 'ebook');

            // Exclude ebook-only items since this application is an audiobook player
            if (!abook) continue;

            seenIds.add(id);

            const coverUrl = abook?.cover?.url || ebook?.cover?.url || model.cover?.url || '';
            const { language, languageName } = this.extractLanguageInfo(model, raw);

            results.push({
              id,
              title,
              authors: Array.isArray(model.authors)
                ? model.authors.map((a: any) => a?.name || a).join(', ')
                : '',
              narrators: Array.isArray(model.narrators)
                ? model.narrators.map((n: any) => n?.name || n).join(', ')
                : '',
              coverUrl,
              category: model.category?.name || model.category?.title || '',
              durationMs: abook?.durationInMilliseconds || 0,
              description: model.description || '',
              hasAbook: !!abook,
              hasEbook: !!ebook,
              language,
              languageName,
              ...seriesField(model.seriesInfo),
            });
          }

          if (results.length > 0) return results;
        } catch {
          // Try next api.storytel.net endpoint
        }
      }
    } catch (err) {
      console.warn('[storytelApi] api.storytel.net search failed, trying fallback:', err);
    }

    // 2. Fallback to storytel.com web search API if authenticated search returned 0 results.
    // The endpoint is scoped by URL path (`/{country}/{lang}/api/search.action`, where only
    // the country segment decides the catalog) and answers for the Swedish market when the
    // prefix is missing. Without a known market it is skipped entirely: hits from a foreign
    // catalog cannot be added to this account's bookshelf anyway.
    const country = await this.getMarketCountryCode();
    if (!country) {
      console.warn('[storytelApi] market country unknown, skipping storytel.com fallback search');
      return results;
    }

    try {
      const searchActionUrl = `${webSearchBaseUrl(country)}/api/search.action?q=${encodeURIComponent(trimmed)}`;
      // Redirects are never followed: markets whose public search is gated
      // behind sign-in (us, gb) answer 3xx towards an OAuth page, and following
      // that would only download HTML that is discarded below.
      const response = await this.send(
        { url: searchActionUrl, headers: { Accept: 'application/json, text/plain, */*' } },
        { auth: false },
      );

      const data = response.data;
      if (data && Array.isArray(data.books)) {
        for (const item of data.books) {
          const book = item?.book || {};
          const abook = item?.abook || {};
          const ebook = item?.ebook || {};

          const hasAbook = !!abook.id || !!item.abook;
          // Exclude ebook-only items since this application is an audiobook player
          if (!hasAbook) continue;

          const id = String(book.consumableId || book.id || abook.id || item.id || '');
          const title = book.name || book.title || '';
          if (!id || !title || seenIds.has(id)) continue;
          seenIds.add(id);

          const coverUrl =
            book.largeCover ||
            book.largeCoverE ||
            book.cover ||
            book.coverE ||
            book.smallCover ||
            abook.cover ||
            '';

          const authors =
            book.authorsAsString ||
            (Array.isArray(book.authors)
              ? book.authors.map((a: any) => a?.name || a).join(', ')
              : '');

          const narrators =
            abook.narratorAsString ||
            (Array.isArray(abook.narrators)
              ? abook.narrators.map((n: any) => n?.name || n).join(', ')
              : '');

          const durationMs = abook.length
            ? Number(abook.length)
            : abook.time
              ? Math.floor(Number(abook.time) / 1000000)
              : 0;

          const { language, languageName } = this.extractLanguageInfo(book, item, item);

          results.push({
            id,
            title,
            authors: authors || '',
            narrators: narrators || '',
            coverUrl: coverUrl || '',
            category: book.category?.title || book.category?.name || '',
            durationMs,
            description: abook.description || ebook.description || '',
            hasAbook: true,
            hasEbook: !!ebook.id || !!item.ebook,
            language,
            languageName,
          });
        }

        if (results.length > 0) {
          return results;
        }
      }
    } catch (err) {
      console.warn('[storytelApi] storytel.com fallback search failed:', err);
    }

    return results;
  }

  // True when a /libraries/bookshelf delta response explicitly contains the
  // consumable. The endpoint keys `items` by consumable id, but tolerate an
  // entry whose model carries the id instead.
  private deltaContainsConsumable(data: any, consumableId: string): boolean {
    const items = data?.items;
    if (!items || typeof items !== 'object' || Array.isArray(items)) {
      return false;
    }
    return Object.entries(items).some(
      ([key, entry]: [string, any]) =>
        key === consumableId || String(entry?.model?.id ?? '') === consumableId,
    );
  }

  // Re-read the bookshelf and check whether the consumable really landed there.
  private async isOnBookshelf(consumableId: string): Promise<boolean> {
    try {
      const { books } = await this.getBookshelf();
      return books.some(
        (entry) => String(entry.id) === consumableId || entry.book?.consumableId === consumableId,
      );
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      console.warn('[storytelApi] bookshelf verification read failed:', error.message);
      return false;
    }
  }

  /**
   * Add a book to the user's Storytel bookshelf.
   *
   * `/libraries/bookshelf` is a JSON delta-sync endpoint. It answers 200 with
   * the current bookshelf even for a body it could not parse, so a successful
   * HTTP status proves nothing: every write is verified against the bookshelf
   * before it is reported back as added.
   */
  // Build the `model` for a bookshelf item, mirroring the shape the endpoint
  // itself returns for existing shelf entries. A "SET" carries the whole model,
  // not a patch, so it is enriched from book-details when that call succeeds and
  // degrades to the bare identity fields when it does not.
  private async buildBookshelfModel(
    consumableId: string,
    state: string,
    stateUpdateTime: string,
  ): Promise<Record<string, unknown>> {
    const base = {
      id: consumableId,
      state,
      stateUpdateTime,
      deepLink: `storytel://book-details-page/book-details/consumables/${consumableId}`,
      resultType: 'book',
    };

    try {
      const details = await this.getBookDetails(consumableId);
      return {
        ...base,
        title: details?.title ?? '',
        shareUrl: details?.shareUrl ?? '',
        kidsBook: !!details?.kidsBook,
        authors: Array.isArray(details?.authors) ? details.authors : [],
        narrators: Array.isArray(details?.narrators) ? details.narrators : [],
        formats: Array.isArray(details?.formats) ? details.formats : [],
        duration: details?.duration,
        category: details?.category,
        language: details?.language,
      };
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      console.warn(
        '[storytelApi] could not enrich bookshelf model, using minimal one:',
        error.message,
      );
      return { ...base, kidsBook: false };
    }
  }

  async addToBookshelf(consumableId: string): Promise<{ added: boolean; strategy: string | null }> {
    const id = String(consumableId);
    const now = new Date().toISOString();

    // A delta is only meaningful relative to the cursor it was computed from,
    // so start by reading the current state to pick up its resourceVersion.
    let current: RawBookshelfResponse;
    try {
      current = await this.fetchBookshelfSnapshot();
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      const customError: any = new Error(`Failed to add book to bookshelf: ${error.message}`);
      customError.status = error.status || 500;
      throw customError;
    }

    if (this.deltaContainsConsumable(current, id)) {
      return { added: true, strategy: 'already-on-bookshelf' };
    }

    const resourceVersion = current.resourceVersion;
    const model = await this.buildBookshelfModel(id, 'WILL_CONSUME', now);

    // `items` is map[consumableId] -> { action, model }, per the server's own
    // schema validation error.
    try {
      // Only `items` is sent: omitting followingItems/collections keeps the
      // delta narrow, so there is no way for an empty map to be read as
      // "clear these".
      const data = await this.postBookshelfDelta({
        ...(resourceVersion ? { resourceVersion } : {}),
        items: { [id]: { action: 'SET', model } },
      });
      if (this.deltaContainsConsumable(data, id)) {
        return { added: true, strategy: 'sync-items-map' };
      }
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      const detail = error.data?.message || error.data?.error || error.message;
      const customError: any = new Error(`Failed to add book to bookshelf: ${detail}`);
      customError.status = error.status || 500;
      throw customError;
    }

    // The response did not echo the book back; ask the bookshelf itself in case
    // the write was applied asynchronously.
    if (await this.isOnBookshelf(id)) {
      return { added: true, strategy: 'sync-verified' };
    }

    // Every request went through, but the book is still not on the shelf.
    return { added: false, strategy: null };
  }

  // Storytel's delta protocol is not publicly documented. `SET` is confirmed by
  // observation (it is what the app itself sends), but the verb for taking a
  // book off the shelf is not, so try the plausible ones and let the bookshelf
  // itself decide which worked. Nothing is reported as removed until a fresh
  // read of the shelf no longer contains the book.
  private static readonly REMOVE_ACTIONS = ['DELETE', 'REMOVE', 'UNSET'];

  async removeFromBookshelf(
    consumableId: string,
  ): Promise<{ removed: boolean; strategy: string | null }> {
    const id = String(consumableId);

    let current: RawBookshelfResponse;
    try {
      current = await this.fetchBookshelfSnapshot();
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      const customError: any = new Error(`Failed to remove book from bookshelf: ${error.message}`);
      customError.status = error.status || 500;
      throw customError;
    }

    if (!this.deltaContainsConsumable(current, id)) {
      return { removed: true, strategy: 'not-on-bookshelf' };
    }

    let resourceVersion = current.resourceVersion;
    let lastError: any = null;

    // Bare action first; a schema that insists on a model is handled by the
    // final attempt, which reuses the same builder as addToBookshelf.
    const attempts: { strategy: string; build: () => Promise<Record<string, unknown>> }[] =
      StorytelClient.REMOVE_ACTIONS.map((action) => ({
        strategy: action.toLowerCase(),
        build: async () => ({ items: { [id]: { action } } }),
      }));

    attempts.push({
      strategy: 'delete-with-model',
      build: async () => ({
        items: {
          [id]: {
            action: 'DELETE',
            model: await this.buildBookshelfModel(id, 'WILL_CONSUME', new Date().toISOString()),
          },
        },
      }),
    });

    for (const attempt of attempts) {
      let body: Record<string, unknown>;
      try {
        body = await attempt.build();
      } catch (error: any) {
        if (error.isStorytelUnauthorized) throw error;
        lastError = error;
        continue;
      }

      try {
        await this.postBookshelfDelta({
          ...(resourceVersion ? { resourceVersion } : {}),
          ...body,
        });
      } catch (error: any) {
        if (error.isStorytelUnauthorized) throw error;
        // A rejected verb says nothing about the shelf itself - try the next.
        lastError = error;
        continue;
      }

      if (!(await this.isOnBookshelf(id))) {
        return { removed: true, strategy: `sync-${attempt.strategy}` };
      }

      // The write was accepted but changed nothing. Refresh the cursor so the
      // next delta is computed against the state the server actually has.
      try {
        resourceVersion = (await this.fetchBookshelfSnapshot()).resourceVersion;
      } catch {
        // Keep the previous cursor; the next attempt may still be accepted.
      }
    }

    if (lastError && !(lastError instanceof StorytelHttpError)) {
      const detail = lastError.message;
      const customError: any = new Error(`Failed to remove book from bookshelf: ${detail}`);
      customError.status = 500;
      throw customError;
    }

    // Every candidate was tried and the book is still on the shelf.
    return { removed: false, strategy: null };
  }

  async getBookDetails(consumableId: string): Promise<any> {
    const url = `https://api.storytel.net/book-details/consumables/${consumableId}?kidsMode=false&configVariant=default`;

    try {
      const response = await this.send({ url, headers: { Accept: '*/*' } }, { auth: true });
      return response.data;
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      throw new Error(`Failed to get book details: ${error.message}`);
    }
  }

  async getPlayBookMetaData(consumableId: string): Promise<any> {
    const hasChapters = (data: any) => {
      if (!data || typeof data !== 'object') return false;
      if (Array.isArray(data.chapters) && data.chapters.length > 0) return true;
      if (Array.isArray(data.tracks) && data.tracks.length > 0) return true;
      if (Array.isArray(data.items) && data.items.length > 0) return true;
      if (
        data.abook?.chapters &&
        Array.isArray(data.abook.chapters) &&
        data.abook.chapters.length > 0
      )
        return true;
      const abook = Array.isArray(data.formats)
        ? data.formats.find((f: any) => f.type === 'abook')
        : null;
      if (abook?.chapters && Array.isArray(abook.chapters) && abook.chapters.length > 0)
        return true;
      if (abook?.tracks && Array.isArray(abook.tracks) && abook.tracks.length > 0) return true;
      return false;
    };

    const candidates = [
      `https://api.storytel.net/playback-metadata/consumables/${consumableId}`,
      `https://api.storytel.net/playback-metadata/consumable/${consumableId}`,
      `https://api.storytel.net/playback-metadata/v2/consumables/${consumableId}`,
      `https://api.storytel.net/assets/v2/consumables/${consumableId}/abook`,
      `https://api.storytel.net/consumables/${consumableId}/tracks`,
      `https://api.storytel.net/consumables/${consumableId}/chapters`,
    ];

    let fallbackData: any = null;
    let lastError: any = null;

    try {
      for (const url of candidates) {
        try {
          const response = await this.send(
            { url, headers: { Accept: 'application/json, text/plain, */*' } },
            { auth: true },
          );
          if (response.data) {
            if (hasChapters(response.data)) {
              return response.data;
            }
            if (!fallbackData) {
              fallbackData = response.data;
            }
          }
        } catch (error: any) {
          if (error.isStorytelUnauthorized) throw error;
          lastError = error;
        }
      }
    } catch (err: any) {
      if (err.isStorytelUnauthorized) throw err;
      lastError = err;
    }

    try {
      await this.ensureLoggedIn();
      const legacyToken = this.loginData.accountInfo.singleSignToken;
      if (legacyToken) {
        const legacyUrls = [
          `https://www.storytel.com/api/getBookInfo.action?token=${encodeURIComponent(legacyToken)}&programId=${encodeURIComponent(consumableId)}`,
          `https://www.storytel.com/api/getABookTracks.action?token=${encodeURIComponent(legacyToken)}&programId=${encodeURIComponent(consumableId)}`,
          `https://www.storytel.com/api/getChapters.action?token=${encodeURIComponent(legacyToken)}&programId=${encodeURIComponent(consumableId)}`,
        ];
        for (const legacyUrl of legacyUrls) {
          try {
            const response = await this.send({ url: legacyUrl }, { auth: false });
            if (response.data) {
              if (hasChapters(response.data)) {
                return response.data;
              }
              if (!fallbackData) {
                fallbackData = response.data;
              }
            }
          } catch {
            // Try next legacy url
          }
        }
      }
    } catch (err: any) {
      // Rejected credentials must reach the caller; anything else falls through.
      if (err?.isLoginFailure) throw err;
    }

    // Try book-details as last resort
    if (!fallbackData) {
      try {
        const details = await this.getBookDetails(consumableId);
        if (details) return details;
      } catch (err: any) {
        if (err.isStorytelUnauthorized) throw err;
        lastError = err;
      }
    } else {
      return fallbackData;
    }

    throw new Error(`Failed to get bookinfo: ${lastError?.message || 'Unknown error'}`);
  }

  // New api.storytel.net audio endpoint. Returns a 302 redirect to a signed
  // mp3 URL on the CDN. Keyed by consumableId (not the abook/program id).
  async getAudioStreamUrl(consumableId: string): Promise<string> {
    const url = `https://api.storytel.net/assets/v2/consumables/${consumableId}/abook`;

    let response: StorytelResponse<unknown>;
    try {
      response = await this.send({ url, headers: { Accept: '*/*' } }, { auth: true });
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      throw new Error(`Failed to get audio stream URL: ${error.message}`);
    }
    // Redirects are never followed, so the signed URL is the 302 Location.
    return streamLocation(response);
  }

  async getStreamUrl(bookId: string): Promise<string> {
    let response: StorytelResponse<unknown>;
    try {
      await this.ensureLoggedIn();
      const url = `https://www.storytel.com/mp3streamRangeReq?startposition=0&programId=${bookId}&token=${encodeURIComponent(this.loginData.accountInfo.singleSignToken)}`;
      response = await this.send({ url }, { auth: false });
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      throw new Error(`Failed to get stream URL: ${error.message}`);
    }
    return streamLocation(response);
  }

  async getBookmark(consumableId: string): Promise<BookmarkResponse> {
    const url = `https://api.storytel.net/bookmarks/manual?type=abook&consumableId=${consumableId}`;

    try {
      const response = await this.send<BookmarkResponse>(
        { url, headers: { Accept: BOOKMARK_ACCEPT } },
        { auth: true },
      );
      return response.data;
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      throw new Error(`Failed to get bookmark: ${error.message}`);
    }
  }

  async setBookmark(consumableId: string, position: number, note: string): Promise<void> {
    const url = 'https://api.storytel.net/bookmarks/manual';
    try {
      await this.send(
        {
          method: 'POST',
          url,
          headers: { Accept: BOOKMARK_ACCEPT },
          body: { json: { position, consumableId, note, type: 'abook' } },
        },
        { auth: true },
      );
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      throw new Error(`Failed to set bookmark: ${error.message}`);
    }
  }

  async updateBookmark(consumableId: string, bookmarkId: string, bookmarkData: any): Promise<void> {
    const { bookmarks } = await this.getBookmark(consumableId);

    if (!bookmarks || !bookmarks.some((bookmark) => bookmark.id === bookmarkId)) {
      throw new Error(`Failed to remove bookmark: bookmark does not exists!`);
    }

    const url = `https://api.storytel.net/bookmarks/manual/${bookmarkId}?id=${bookmarkId}`;
    try {
      await this.send(
        {
          method: 'PUT',
          url,
          headers: { Accept: BOOKMARK_ACCEPT },
          ...(bookmarkData === undefined ? {} : { body: { json: bookmarkData } }),
        },
        { auth: true },
      );
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      throw new Error(`Failed to update bookmark: ${error.message}`);
    }
  }

  async deleteBookmark(consumableId: string, bookmarkId: string): Promise<void> {
    const { bookmarks } = await this.getBookmark(consumableId);

    if (!bookmarks || !bookmarks.some((bookmark) => bookmark.id === bookmarkId)) {
      throw new Error(`Failed to remove bookmark: bookmark does not exists!`);
    }

    const url = `https://api.storytel.net/bookmarks/manual/${bookmarkId}?id=${bookmarkId}`;
    try {
      await this.send(
        { method: 'DELETE', url, headers: { Accept: BOOKMARK_ACCEPT } },
        { auth: true },
      );
    } catch (error: any) {
      if (error.isStorytelUnauthorized) throw error;
      throw new Error(`Failed to delete bookmark: ${error.message}`);
    }
  }

  // GET on an explore endpoint with the bearer only (no `store` param is
  // needed), always with kidsMode=false. Cached per URL for an hour.
  private async exploreGet<T>(url: string): Promise<T> {
    const target = new URL(url);
    target.searchParams.set('kidsMode', 'false');
    target.searchParams.delete('store');
    const key = target.toString();
    const cached = this.exploreCache.get(key);
    if (cached !== undefined) return cached as T;
    const response = await this.send<T>(
      { url: key, headers: { Accept: 'application/json' } },
      { auth: true },
    );
    this.exploreCache.set(key, response.data);
    return response.data;
  }

  // Front-page tabs that hold audiobooks. The first chip is the home page.
  async getExploreChips(): Promise<DiscoveryChip[]> {
    const data = await this.exploreGet<any>(`${EXPLORE_BASE}/frontpage/chips`);
    const chips: DiscoveryChip[] = (Array.isArray(data?.chips) ? data.chips : [])
      .filter((chip: any) => chip?.id && chip?.pageSlug)
      .map((chip: any) => ({
        id: String(chip.id),
        label: String(chip.label ?? ''),
        pageSlug: String(chip.pageSlug),
      }));
    const playable = await Promise.all(
      chips.map(async (chip, index) => {
        try {
          return await this.chipHasAudiobooks(chip);
        } catch (error) {
          // The first chip is the home page: without it there is no front
          // page, so its errors surface. Any other chip that fails is dropped
          // (a dead tab must not hide the rest), except an expired session.
          if (index === 0 || error instanceof StorytelAuthError) {
            throw error;
          }
          return false;
        }
      }),
    );
    return chips.filter((_, index) => playable[index]);
  }

  // A chip is kept when its page shows audiobooks. Inline rows are checked
  // directly; a page made only of lazy rows is judged by its first few rows.
  private async chipHasAudiobooks(chip: DiscoveryChip): Promise<boolean> {
    // Errors propagate to getExploreChips, which decides whether the chip is
    // dropped or the whole call fails.
    const page = await this.getExplorePage(chip.pageSlug);
    if (page.rows.some((row) => row.items.length > 0)) return true;
    const lazyUrls = page.rows.flatMap((row) => (row.itemsUrl ? [row.itemsUrl] : []));
    for (const itemsUrl of lazyUrls.slice(0, CHIP_PROBE_ROWS)) {
      try {
        if ((await this.getExploreList(itemsUrl)).items.length > 0) return true;
      } catch (error) {
        // Personalised rows ("new episodes for you") answer 404 for accounts
        // without matching content; such a row says nothing about the chip.
        if (!isClientErrorRow(error)) throw error;
      }
    }
    return false;
  }

  async getExplorePage(pageSlug: string, nextPageToken?: string): Promise<DiscoveryPage> {
    const url = new URL(`${EXPLORE_BASE}/pages/${encodeURIComponent(pageSlug)}`);
    url.searchParams.set('kidsMode', 'false');
    if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
    return toDiscoveryPage(await this.exploreGet<any>(url.toString()));
  }

  // Audiobooks of a lazy row's list. Rejects URLs outside api.storytel.net/explore/.
  async getExploreList(url: string, nextPageToken?: string): Promise<DiscoveryList> {
    if (!isAllowedExploreUrl(url)) {
      throw Object.assign(new Error('Not an explore URL'), { statusCode: 400 });
    }
    const target = new URL(url);
    if (nextPageToken) target.searchParams.set('nextPageToken', nextPageToken);
    const list = toDiscoveryList(await this.exploreGet<any>(target.toString()));
    return { ...list, items: playableOnly(list.items) };
  }

  // Every part of a series in every format (the caller decides what is
  // playable), in series order. Stops after SERIES_MAX_PAGES pages.
  async getSeries(seriesId: string): Promise<{ title: string; items: DiscoveryItem[] }> {
    let title = '';
    const items: DiscoveryItem[] = [];
    let token: string | undefined;
    for (let page = 0; page < SERIES_MAX_PAGES; page++) {
      const url = new URL(`${EXPLORE_BASE}/lists/series/${encodeURIComponent(seriesId)}`);
      url.searchParams.set('includeListDetails', 'true');
      url.searchParams.set('orderBy', 'seriesOrder');
      url.searchParams.set('kidsMode', 'false');
      if (token) url.searchParams.set('nextPageToken', token);
      const list = toDiscoveryList(await this.exploreGet<any>(url.toString()));
      title ||= list.title;
      items.push(...list.items);
      if (!list.nextPageToken) break;
      token = list.nextPageToken;
    }
    return { title, items };
  }
}

function durationMsOf(raw: any, abook: any): number {
  if (typeof abook?.durationInMilliseconds === 'number') return abook.durationInMilliseconds;
  const d = raw?.duration;
  if (!d) return 0;
  return (((d.hours ?? 0) * 60 + (d.minutes ?? 0)) * 60 + (d.seconds ?? 0)) * 1000;
}

// Maps an explore item to the search result shape. Unlike a search hit it keeps
// ebook-only items (hasAbook=false): series screens grey those parts out.
export function mapCatalogItem(item: DiscoveryItem): SearchResultBook {
  const raw: any = item.raw;
  const formats: any[] = Array.isArray(raw?.formats) ? raw.formats : [];
  const abook = formats.find((f) => f?.type === 'abook');
  const ebook = formats.find((f) => f?.type === 'ebook');
  const names = (list: unknown) =>
    (Array.isArray(list) ? list : [])
      .map((x: any) => (typeof x === 'string' ? x : x?.name))
      .filter(Boolean)
      .join(', ');
  return {
    id: item.id,
    title: item.title,
    authors: names(raw?.authors),
    narrators: names(raw?.narrators),
    coverUrl: item.coverUrl ?? '',
    category: raw?.category?.name ?? '',
    durationMs: abook ? durationMsOf(raw, abook) : 0,
    description: raw?.description ?? '',
    hasAbook: item.hasAbook,
    comingSoon: item.comingSoon,
    releaseDate: item.releaseDate,
    hasEbook: !!ebook,
    language: typeof raw?.language === 'string' ? raw.language.toLowerCase() : undefined,
    ...seriesField(item.seriesInfo),
  };
}

export default StorytelClient;
