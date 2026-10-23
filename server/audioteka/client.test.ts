import { describe, expect, test } from 'bun:test';
import type { FetchLike } from '../http';
import { redactLogData } from '../logger';
import {
  AudiotekaClient,
  type AudiotekaCredentials,
  AudiotekaHttpError,
  AudiotekaUnauthorizedError,
} from './client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

type Handler = (call: Call) => Response;

// Records every request and answers from the first matching handler.
function stubFetch(handlers: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
    };
    calls.push(call);
    const key =
      call.path === '/v2/commands'
        ? `command:${String(body?.name)}`
        : `${call.method} ${call.path}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`unexpected request ${key}`);
    if (Array.isArray(handler)) {
      const next = handler.shift();
      if (!next) throw new Error(`no more answers for ${key}`);
      return next(call);
    }
    return handler(call);
  };
  return { fetchImpl, calls };
}

const CONFIG = 'GET /v2/apps/config/android';
const config =
  (version = '3.60.1'): Handler =>
  () =>
    json({ app_version_config: { current_version: version } });
const refreshReply =
  (n = 1): Handler =>
  () =>
    json({
      token: `token-${n}`,
      refresh_id: `rotated-${n}`,
      expires_at: '2027-01-22T03:18:03+00:00',
    });

const NOW = Date.parse('2026-10-22T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function makeClient(
  fetchImpl: FetchLike,
  credentials: Partial<AudiotekaCredentials> = {},
  now = NOW,
  events: string[] = [],
) {
  const changed: AudiotekaCredentials[] = [];
  let rejected = 0;
  const client = new AudiotekaClient({
    credentials: {
      deviceId: 'dev-1',
      refreshId: 'refresh-0',
      token: 'token-0',
      expiresAt: new Date(now + 60 * DAY).toISOString(),
      ...credentials,
    },
    fetch: fetchImpl,
    now: () => now,
    onCredentialsChanged: (c) => {
      changed.push(c);
      events.push('persisted');
    },
    onCredentialsRejected: () => {
      rejected++;
    },
  });
  return { client, changed, rejected: () => rejected };
}

const PROGRESS = (id: string) => `GET /v2/me/playback-progress/${id}`;
const progress: Handler = () => json({ position: 1000, device: 'Pixel' });

describe('AudiotekaClient token handling', () => {
  test('refreshes once for concurrent requests', async () => {
    const order: string[] = [];
    const { fetchImpl, calls } = stubFetch({
      [CONFIG]: config(),
      'command:RefreshToken': (call) => {
        order.push('refresh');
        expect(call.headers.authorization).toBeUndefined();
        expect(call.body).toEqual({
          name: 'RefreshToken',
          refresh_id: 'refresh-0',
          device_id: 'dev-1',
        });
        return refreshReply(1)(call);
      },
      [PROGRESS('a')]: (call) => {
        order.push('request');
        expect(call.headers.authorization).toBe('Bearer token-1');
        return progress(call);
      },
      [PROGRESS('b')]: progress,
    });
    const { client, changed } = makeClient(fetchImpl, { token: null, expiresAt: null }, NOW, order);

    await Promise.all([client.getPosition('a'), client.getPosition('b')]);

    expect(calls.filter((c) => c.body?.name === 'RefreshToken')).toHaveLength(1);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.refreshId).toBe('rotated-1');
    expect(changed[0]?.token).toBe('token-1');
    expect(order.indexOf('persisted')).toBeLessThan(order.indexOf('request'));
  });

  test('calls onCredentialsChanged before the refresh resolves', async () => {
    const { fetchImpl } = stubFetch({
      [CONFIG]: config(),
      'command:RefreshToken': refreshReply(1),
    });
    const { client, changed } = makeClient(fetchImpl);
    await client.refresh();
    expect(changed).toEqual([
      {
        deviceId: 'dev-1',
        refreshId: 'rotated-1',
        token: 'token-1',
        expiresAt: '2027-01-22T03:18:03+00:00',
      },
    ]);
  });

  test('retries once after 401', async () => {
    const { fetchImpl, calls } = stubFetch({
      [CONFIG]: config(),
      'command:RefreshToken': refreshReply(1),
      [PROGRESS('a')]: [() => json({}, 401), progress],
    });
    const { client } = makeClient(fetchImpl);

    expect(await client.getPosition('a')).toEqual({ positionMs: 1000, device: 'Pixel' });
    expect(calls.filter((c) => c.path === PROGRESS('a').slice(4))).toHaveLength(2);
  });

  test('a second 401 rejects without a third attempt', async () => {
    const { fetchImpl, calls } = stubFetch({
      [CONFIG]: config(),
      'command:RefreshToken': refreshReply(1),
      [PROGRESS('a')]: [() => json({}, 401), () => json({}, 401)],
    });
    const { client } = makeClient(fetchImpl);

    await expect(client.getPosition('a')).rejects.toThrow();
    expect(calls.filter((c) => c.path.startsWith('/v2/me/playback-progress'))).toHaveLength(2);
    expect(calls.filter((c) => c.body?.name === 'RefreshToken')).toHaveLength(1);
  });

  test('rejected refresh ends the session', async () => {
    const { fetchImpl } = stubFetch({
      [CONFIG]: config(),
      'command:RefreshToken': () => json({ message: 'nope' }, 401),
    });
    const { client, rejected, changed } = makeClient(fetchImpl, { token: null });

    await expect(client.getPosition('a')).rejects.toBeInstanceOf(AudiotekaUnauthorizedError);
    expect(rejected()).toBe(1);
    expect(changed).toHaveLength(0);
  });

  test('refreshes when the token is within 7 days of expiry', async () => {
    const expiresAt = '2026-12-01T00:00:00Z';
    const expiry = Date.parse(expiresAt);
    const near = stubFetch({
      [CONFIG]: config(),
      'command:RefreshToken': refreshReply(1),
      [PROGRESS('a')]: progress,
    });
    await makeClient(near.fetchImpl, { expiresAt }, expiry - 6 * DAY).client.getPosition('a');
    expect(near.calls.some((c) => c.body?.name === 'RefreshToken')).toBe(true);

    const far = stubFetch({ [CONFIG]: config(), [PROGRESS('a')]: progress });
    await makeClient(far.fetchImpl, { expiresAt }, expiry - 8 * DAY).client.getPosition('a');
    expect(far.calls.some((c) => c.body?.name === 'RefreshToken')).toBe(false);
  });
});

describe('AudiotekaClient requests', () => {
  test('uses current_version from the config in the User-Agent', async () => {
    const { fetchImpl, calls } = stubFetch({
      [CONFIG]: config('3.61.0'),
      [PROGRESS('a')]: progress,
    });
    const { client } = makeClient(fetchImpl);
    await client.getPosition('a');
    await client.getPosition('a');

    const request = calls.find((c) => c.path.startsWith('/v2/me/playback-progress'));
    expect(request?.headers['user-agent']).toBe(
      'Audioteka/3.61.0 (3550) Android/14 (Phone;Pixel 8)',
    );
    expect(request?.headers.authorization).toBe('Bearer token-0');
    expect(calls.filter((c) => c.path === '/v2/apps/config/android')).toHaveLength(1);
  });

  test('falls back to 3.55.0 when the config call fails', async () => {
    const { fetchImpl, calls } = stubFetch({
      [CONFIG]: () => json({}, 500),
      [PROGRESS('a')]: progress,
    });
    await makeClient(fetchImpl).client.getPosition('a');
    expect(calls.at(-1)?.headers['user-agent']).toBe(
      'Audioteka/3.55.0 (3550) Android/14 (Phone;Pixel 8)',
    );
  });

  test('getPosition returns null on 404', async () => {
    const { fetchImpl } = stubFetch({ [CONFIG]: config(), [PROGRESS('a')]: () => json({}, 404) });
    expect(await makeClient(fetchImpl).client.getPosition('a')).toBeNull();
  });

  test('savePosition sends the command body', async () => {
    const { fetchImpl, calls } = stubFetch({
      [CONFIG]: config(),
      'command:SavePlaybackProgress': () => new Response(null, { status: 204 }),
    });
    await makeClient(fetchImpl).client.savePosition('r1', 5098.4);

    const call = calls.at(-1);
    expect(call?.method).toBe('POST');
    expect(call?.headers['content-type']).toBe('application/json');
    expect(call?.body).toEqual({
      name: 'SavePlaybackProgress',
      audiobook_id: 'r1',
      position: 5098,
      device: 'Bookwave',
    });
  });

  test('startPlayback sends the command body', async () => {
    const { fetchImpl, calls } = stubFetch({
      [CONFIG]: config(),
      'command:StartPlayback': () => new Response(null, { status: 204 }),
    });
    await makeClient(fetchImpl).client.startPlayback('r1');
    expect(calls.at(-1)?.body).toEqual({ name: 'StartPlayback', audiobook_id: 'r1' });
  });

  test('getTrackUrl computes the expiry from the lifetime', async () => {
    const { fetchImpl } = stubFetch({
      [CONFIG]: config(),
      'GET /v2/tracks/t1/stream': () =>
        json({ id: 't1', url: 'https://cdn.example/t1.mp3', lifetime_in_seconds: 10800 }),
    });
    expect(await makeClient(fetchImpl).client.getTrackUrl('t1')).toEqual({
      url: 'https://cdn.example/t1.mp3',
      expiresAt: NOW + 10800 * 1000,
    });
  });

  test('getBook and getTimeline map the responses', async () => {
    const { fetchImpl } = stubFetch({
      [CONFIG]: config(),
      'GET /v2/audiobooks/b1': () => json({ id: 'b1', name: 'Book', tracks_duration_in_ms: 5000 }),
      'GET /v2/audiobooks/b1/tracks': () =>
        json({
          _embedded: {
            'app:track': [
              { id: 't2', index: 2, duration: 3000 },
              { id: 't1', index: 1, duration: 2000 },
            ],
          },
        }),
    });
    const { client } = makeClient(fetchImpl);
    expect((await client.getBook('b1')).title).toBe('Book');
    expect((await client.getTimeline('b1')).map((t) => [t.id, t.startMs])).toEqual([
      ['t1', 0],
      ['t2', 2000],
    ]);
  });
});

describe('AudiotekaClient getLibrary', () => {
  const item = (id: string) => ({ id, name: `Book ${id}`, tracks_duration_in_ms: 1000 });
  const list =
    (...ids: string[]) =>
    () =>
      json({ _embedded: { 'app:audiobook': ids.map(item) } });
  const listRoutes = {
    [CONFIG]: config(),
    'GET /v2/me/recently-played': list('a', 'b'),
    'GET /v2/me/favourites': list('b'),
    'GET /v2/me/shelf': list('c'),
    'GET /v2/me/playback-progress': () =>
      json({ _embedded: { 'app:playback-progress': [{ product_id: 'a', position: 42 }] } }),
  };

  test('marks a book unavailable from license channels', async () => {
    const { fetchImpl } = stubFetch({
      ...listRoutes,
      'GET /v2/me/audiobook-license-channels/a': () => json({ promotion: { state: 'CAN_LISTEN' } }),
      'GET /v2/me/audiobook-license-channels/b': () => json({ shop: { state: 'CAN_BUY' } }),
      'GET /v2/me/audiobook-license-channels/c': () => json({ club: { state: 'CAN_LISTEN' } }),
    });
    const library = await makeClient(fetchImpl).client.getLibrary();

    expect(library.map((e) => [e.id, e.available])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
    expect(library[0]?.positionMs).toBe(42);
    expect(library[1]?.sources).toEqual(['recent', 'favourite']);
  });

  test('keeps it available when the license call fails', async () => {
    const { fetchImpl } = stubFetch({
      ...listRoutes,
      'GET /v2/me/audiobook-license-channels/a': () => json({}, 500),
      'GET /v2/me/audiobook-license-channels/b': () => json({ shop: { state: 'CAN_BUY' } }),
      'GET /v2/me/audiobook-license-channels/c': () => json({}, 404),
    });
    const library = await makeClient(fetchImpl).client.getLibrary();
    expect(library.map((e) => e.available)).toEqual([true, false, true]);
  });

  test('keeps at most 4 license requests in flight', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `x${i}`);
    let inFlight = 0;
    let peak = 0;
    const base = stubFetch({
      ...listRoutes,
      'GET /v2/me/recently-played': list(...ids),
    }).fetchImpl;
    const fetchImpl: FetchLike = async (input, init) => {
      const { pathname } = new URL(String(input));
      if (!pathname.includes('license-channels')) return base(input, init);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return json({ club: { state: 'CAN_LISTEN' } });
    };
    await makeClient(fetchImpl).client.getLibrary();
    expect(peak).toBe(4);
  });
});

describe('log redaction', () => {
  test('masks Audioteka tokens, refresh ids and device ids', () => {
    expect(
      redactLogData({
        token: 'abc',
        refresh_id: 'r',
        refreshId: 'r',
        device_id: 'd',
        deviceId: 'd',
        name: 'RefreshToken',
      }),
    ).toEqual({
      token: '***',
      refresh_id: '***',
      refreshId: '***',
      device_id: '***',
      deviceId: '***',
      name: 'RefreshToken',
    });
  });
});

describe('AudiotekaClient catalogue', () => {
  const club = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: `Book ${id}`,
    image_url: `https://atkcdn.audioteka.com/${id}.jpg`,
    tracks_duration_in_ms: 1000,
    is_available_in_subscription: true,
    cycle_type: null,
    kind: 'Audiobook - pełny',
    authors: [{ id: 'auth-1', value: 'Andrzej Sapkowski' }],
    lectors: [],
    categories: [],
    ...extra,
  });
  const products = (items: unknown[], page = 1, pages = 1, total = items.length) =>
    json({ page, pages, total, _embedded: { 'app:product': items } });
  const me: Handler = () => json({ id: 'u1', catalog: 'cat-1' });

  test('search reads index and filters from /v2/me/algolia', async () => {
    const { fetchImpl, calls } = stubFetch({
      [CONFIG]: config(),
      'GET /v2/me/algolia': () =>
        json({
          index: 'prod_lite_pl_catalog',
          select_facets: [
            { name: 'shelf_only', value: 'false' },
            { name: 'kind', value: 'audiobook' },
          ],
          restrict_facets: [
            { name: 'catalog', value: 'cat-1' },
            { name: 'country', value: 'PL' },
          ],
        }),
      'POST /1/indexes/prod_lite_pl_catalog/query': (call) => {
        expect(call.body).toEqual({
          query: 'sapkowski',
          // As the audioteka.com bundle: select facets ORed, restrict facets ANDed.
          filters:
            "(shelf_only:'false' OR kind:'audiobook') AND (catalog:'cat-1' AND country:'PL')",
          hitsPerPage: 50,
        });
        // The Audioteka bearer never goes to Algolia.
        expect(call.headers.authorization).toBeUndefined();
        return json({
          hits: [club('h1'), club('h2', { is_available_in_subscription: false })],
        });
      },
    });
    const { client } = makeClient(fetchImpl);

    const results = await client.search('sapkowski');

    expect(results.map((book) => book.id)).toEqual(['h1']);
    await client.search('sapkowski');
    // The Algolia settings are cached; each search still queries Algolia.
    expect(calls.filter((c) => c.path === '/v2/me/algolia')).toHaveLength(1);
    expect(calls.filter((c) => c.path.startsWith('/1/indexes/'))).toHaveLength(2);
  });

  test('getList pages an author list', async () => {
    const urls: string[] = [];
    const base = stubFetch({
      [CONFIG]: config(),
      'GET /v2/me': me,
      'GET /v2/authors/auth-1/products': [
        () => products([club('b1'), club('b2', { is_available_in_subscription: false })], 1, 2, 31),
        () => products([club('b3')], 2, 2, 31),
      ],
    });
    const fetchImpl: FetchLike = (input, init) => {
      urls.push(String(input));
      return base.fetchImpl(input, init);
    };
    const { client } = makeClient(fetchImpl);

    const first = await client.getList('author:auth-1', 1);
    expect(first).toEqual({
      title: 'Andrzej Sapkowski',
      totalCount: 31,
      items: [expect.objectContaining({ id: 'b1' })],
      nextPageToken: '2',
    });
    const second = await client.getList('author:auth-1', 2);
    expect(second.items.map((book) => book.id)).toEqual(['b3']);
    expect(second.nextPageToken).toBe(null);

    const authorUrls = urls.filter((url) => url.includes('/v2/authors/'));
    expect(authorUrls.map((url) => new URL(url).search)).toEqual([
      '?catalog=cat-1&page=1&limit=20',
      '?catalog=cat-1&page=2&limit=20',
    ]);
    // Cached: the same page again makes no request.
    await client.getList('author:auth-1', 1);
    expect(urls.filter((url) => url.includes('/v2/authors/'))).toHaveLength(2);
  });

  test('getList pages a cycle list', async () => {
    const urls: string[] = [];
    const base = stubFetch({
      [CONFIG]: config(),
      'GET /v2/me': me,
      'GET /v2/cycles/cyc-1': () => json({ id: 'cyc-1', name: 'Nowości', cycle_type: 'generic' }),
      'GET /v2/cycles/cyc-1/products': [
        () => products([club('b1'), club('b2', { is_available_in_subscription: false })], 1, 3, 60),
        () => products([club('b3')], 3, 3, 60),
      ],
    });
    const fetchImpl: FetchLike = (input, init) => {
      urls.push(String(input));
      return base.fetchImpl(input, init);
    };
    const { client } = makeClient(fetchImpl);

    const first = await client.getList('cycle:cyc-1', 1);
    expect(first).toEqual({
      title: 'Nowości',
      totalCount: 60,
      items: [expect.objectContaining({ id: 'b1' })],
      nextPageToken: '2',
    });
    const last = await client.getList('cycle:cyc-1', 3);
    expect(last.nextPageToken).toBe(null);
    expect(
      urls.filter((url) => url.includes('/products')).map((url) => new URL(url).search),
    ).toEqual(['?catalog=cat-1&page=1&limit=20', '?catalog=cat-1&page=3&limit=20']);
  });

  test('getList rejects section lists and unknown lists', async () => {
    const { fetchImpl } = stubFetch({ [CONFIG]: config() });
    const { client } = makeClient(fetchImpl);
    const section = await client.getList('section:audioteka-new-audiobooks-pl', 1).catch((e) => e);
    expect(section).toBeInstanceOf(AudiotekaHttpError);
    expect(section.status).toBe(404);
    const unknown = await client.getList('genre:x', 1).catch((e) => e);
    expect(unknown).toBeInstanceOf(AudiotekaHttpError);
  });

  test('getHomeRows caches the screen', async () => {
    const { fetchImpl, calls } = stubFetch({
      [CONFIG]: config(),
      'GET /v2/me/screen': () =>
        json({
          _embedded: {
            'app:screen-section': [
              {
                id: 'new',
                type: 'product-grid',
                title: 'Nowości',
                _embedded: { 'app:product': [club('b1')] },
              },
            ],
          },
        }),
    });
    const { client } = makeClient(fetchImpl);

    const rows = await client.getHomeRows();
    await client.getHomeRows();

    expect(rows.map((row) => [row.id, row.items.length])).toEqual([['new', 1]]);
    expect(calls.filter((c) => c.path === '/v2/me/screen')).toHaveLength(1);
  });

  const detail = (id: string) =>
    json({
      id,
      name: 'Upadek gigantów',
      description: 'Pierwszy tom trylogii.',
      image_url: 'https://atkcdn.audioteka.com/b1.jpg',
      tracks_duration_in_ms: 5000,
      is_available_in_subscription: true,
      kind: 'Audiobook - pełny',
      content_language: 'pl',
      _embedded: {
        'app:author': [{ id: 'auth-2', name: 'Ken Follett' }],
        'app:lector': [{ id: 'l1', name: 'Lektor' }],
        'app:category': [
          { id: 'c1', name: 'Powieść historyczna' },
          { id: 'c2', name: 'Literatura piękna' },
        ],
        'app:contained-in': [
          { id: 'gen-1', name: 'Bestsellery', cycle_type: 'generic' },
          { id: 'ser-1', name: 'Stulecie. Seria', cycle_type: 'series' },
        ],
      },
    });

  const bookPageHandlers = (favourites: unknown[]): Record<string, Handler | Handler[]> => ({
    [CONFIG]: config(),
    'GET /v2/me': me,
    'GET /v2/audiobooks/b1': () => detail('b1'),
    'GET /v2/me/favourites': () => products(favourites),
    'GET /v2/me/shelf': () => products([]),
    'GET /v2/me/recently-played': () => products([club('b1')]),
    'GET /v2/me/recommended-after/b1': () =>
      products([club('r1'), club('r2', { is_available_in_subscription: false })]),
    'GET /v2/cycles/ser-1/products': () => products([club('b0'), club('b1'), club('b2')]),
  });

  test('getBookPage marks favourites removable', async () => {
    const { fetchImpl } = stubFetch(bookPageHandlers([club('b1')]));
    const { client } = makeClient(fetchImpl);

    const page = await client.getBookPage('b1');

    expect(page.inLibrary).toBe(true);
    expect(page.removable).toBe(true);
    expect(page.recommendedAfter.map((book) => book.id)).toEqual(['r1']);
    expect(page.book).toMatchObject({
      id: 'b1',
      title: 'Upadek gigantów',
      description: 'Pierwszy tom trylogii.',
      category: 'Powieść historyczna',
      authors: 'Ken Follett',
      authorRefs: [{ id: 'auth-2', name: 'Ken Follett' }],
      seriesInfo: { id: 'ser-1', name: 'Stulecie. Seria', orderInSeries: 2 },
      hasAbook: true,
      language: 'pl',
    });
  });

  test('getBookPage: recently played only is in the library but not removable', async () => {
    const { fetchImpl } = stubFetch(bookPageHandlers([]));
    const { client } = makeClient(fetchImpl);

    const page = await client.getBookPage('b1');

    expect(page.inLibrary).toBe(true);
    expect(page.removable).toBe(false);
  });

  test('getBookPage tolerates a failed library list', async () => {
    const handlers = bookPageHandlers([club('b1')]);
    handlers['GET /v2/me/shelf'] = () => json({}, 500);
    const { fetchImpl } = stubFetch(handlers);
    const { client } = makeClient(fetchImpl);

    const page = await client.getBookPage('b1');

    expect(page.inLibrary).toBe(true);
    expect(page.removable).toBe(true);
  });

  test('getBookPage: a failed favourites list is not removable', async () => {
    const handlers = bookPageHandlers([]);
    handlers['GET /v2/me/favourites'] = () => json({}, 500);
    const { fetchImpl } = stubFetch(handlers);
    const { client } = makeClient(fetchImpl);

    const page = await client.getBookPage('b1');

    expect(page.inLibrary).toBe(true);
    expect(page.removable).toBe(false);
  });

  test('getBookPage caches book data for an hour', async () => {
    const { fetchImpl, calls } = stubFetch(bookPageHandlers([]));
    let clock = NOW;
    const client = new AudiotekaClient({
      credentials: {
        deviceId: 'dev-1',
        refreshId: 'refresh-0',
        token: 'token-0',
        expiresAt: new Date(NOW + 60 * DAY).toISOString(),
      },
      fetch: fetchImpl,
      now: () => clock,
      onCredentialsChanged: () => {},
      onCredentialsRejected: () => {},
    });
    const bookCalls = () =>
      calls.filter((c) => c.path === '/v2/audiobooks/b1' || c.path.startsWith('/v2/cycles/'))
        .length;

    const first = await client.getBookPage('b1');
    const fetched = bookCalls();
    clock += 30 * 60 * 1000;
    const second = await client.getBookPage('b1');
    expect(bookCalls()).toBe(fetched);
    expect(second.book).toEqual(first.book);
    expect(second.recommendedAfter).toEqual(first.recommendedAfter);
    expect(await client.getSeriesInfo('b1')).toEqual(first.book.seriesInfo ?? null);
    expect(bookCalls()).toBe(fetched);

    clock += 31 * 60 * 1000;
    await client.getBookPage('b1');
    expect(calls.filter((c) => c.path === '/v2/audiobooks/b1')).toHaveLength(2);
  });

  test('getSeriesInfo reads only the book, not the library lists', async () => {
    const { fetchImpl, calls } = stubFetch(bookPageHandlers([]));
    const { client } = makeClient(fetchImpl);

    expect(await client.getSeriesInfo('b1')).toEqual({
      id: 'ser-1',
      name: 'Stulecie. Seria',
      orderInSeries: 2,
    });
    expect(calls.some((c) => c.path.startsWith('/v2/me/'))).toBe(false);
  });

  test('library membership is fresh after addToLibrary', async () => {
    const handlers = bookPageHandlers([]);
    handlers['GET /v2/me/favourites'] = [() => products([]), () => products([club('b1')])];
    handlers['GET /v2/me/recently-played'] = () => products([]);
    handlers['command:AddToFavourites'] = () => json({});
    const { fetchImpl } = stubFetch(handlers);
    const { client } = makeClient(fetchImpl);

    const before = await client.getBookPage('b1');
    expect(before.inLibrary).toBe(false);
    await client.addToLibrary('b1');
    const after = await client.getBookPage('b1');
    expect(after.inLibrary).toBe(true);
    expect(after.removable).toBe(true);
  });

  test('unauthorized during getBookPage propagates', async () => {
    for (const failing of [
      'GET /v2/me/recommended-after/b1',
      'GET /v2/cycles/ser-1/products',
      'GET /v2/me/favourites',
    ]) {
      const handlers = bookPageHandlers([]);
      // The extra lookups hit an expired session whose refresh is rejected.
      handlers[failing] = () => json({}, 401);
      handlers['command:RefreshToken'] = () => json({}, 401);
      const { fetchImpl } = stubFetch(handlers);
      const { client } = makeClient(fetchImpl);

      const error = await client.getBookPage('b1').catch((e) => e);

      expect(error).toBeInstanceOf(AudiotekaUnauthorizedError);
    }
  });

  test('getSeries maps a series cycle', async () => {
    const { fetchImpl } = stubFetch({
      [CONFIG]: config(),
      'GET /v2/me': me,
      'GET /v2/cycles/ser-1': () => json({ id: 'ser-1', name: 'Stulecie', cycle_type: 'series' }),
      'GET /v2/cycles/ser-1/products': () => products([club('b0'), club('b1'), club('b2')]),
    });
    const { client } = makeClient(fetchImpl);

    const series = await client.getSeries('ser-1', 'b1');

    expect(series?.parts.map((part) => part.id)).toEqual(['b0', 'b1', 'b2']);
    expect(series?.next?.id).toBe('b2');
  });

  test('addToLibrary sends AddToFavourites', async () => {
    const bodies: unknown[] = [];
    const { fetchImpl } = stubFetch({
      [CONFIG]: config(),
      'command:AddToFavourites': (call) => {
        bodies.push(call.body);
        return json({});
      },
      'command:RemoveFromFavourites': (call) => {
        bodies.push(call.body);
        return json({});
      },
    });
    const { client } = makeClient(fetchImpl);

    await client.addToLibrary('b1');
    await client.removeFromLibrary('b1');

    expect(bodies).toEqual([
      { name: 'AddToFavourites', product_id: 'b1' },
      { name: 'RemoveFromFavourites', product_id: 'b1' },
    ]);
  });
});
