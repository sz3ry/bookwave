import { describe, expect, test } from 'bun:test';
import type { FetchLike } from './fetch';
import { appLogger } from '../logger';
import { encryptPassword } from './passwordCrypt';
import StorytelClient from './client';

interface Call {
  url: URL;
  init: RequestInit;
}

type Handler = (call: Call) => Response | Promise<Response>;

// Routes each request by pathname. An array of handlers is consumed in order,
// the last one repeating once the earlier ones are used up.
function router(routes: Record<string, Handler | Handler[]>): {
  fetchImpl: FetchLike;
  calls: Call[];
  callsTo: (path: string) => Call[];
} {
  const calls: Call[] = [];
  const counters = new Map<string, number>();
  const fetchImpl: FetchLike = async (input, init) => {
    const call = { url: new URL(String(input)), init: init ?? {} };
    calls.push(call);
    const route = routes[call.url.pathname];
    if (!route) throw new Error(`unexpected request to ${call.url.pathname}`);
    if (!Array.isArray(route)) return route(call);
    const index = counters.get(call.url.pathname) ?? 0;
    counters.set(call.url.pathname, index + 1);
    return route[Math.min(index, route.length - 1)](call);
  };
  return {
    fetchImpl,
    calls,
    callsTo: (path) => calls.filter((c) => c.url.pathname === path),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function makeJwt(expInSeconds: number, tag = 'x'): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none' })}.${b64url({ iat: now, exp: now + expInSeconds, tag })}.sig`;
}

let userCounter = 0;
const uniqueEmail = () => `user${++userCounter}@example.com`;

const LOGIN_PATH = '/api/login.action';
const BOOKSHELF_PATH = '/libraries/bookshelf';

const loginOk = (jwt: string) => () => json({ accountInfo: { jwt, singleSignToken: 'sst' } });

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name);

function clientWithSession(fetchImpl: FetchLike, onCredentialsRejected?: () => void) {
  const client = new StorytelClient({ fetch: fetchImpl, onCredentialsRejected });
  client.setCredentials(uniqueEmail(), encryptPassword('secret'));
  client.loginData = { accountInfo: { jwt: makeJwt(3600, 'old'), singleSignToken: 'sst' } };
  return client;
}

describe('StorytelClient', () => {
  test('login sends encrypted password', async () => {
    const jwt = makeJwt(3600);
    const { fetchImpl, callsTo } = router({ [LOGIN_PATH]: loginOk(jwt) });
    const client = new StorytelClient({ fetch: fetchImpl });
    const email = uniqueEmail();

    const data = await client.login(`  ${email}  `, '  hunter2  ');

    const [call] = callsTo(LOGIN_PATH);
    expect(call.init.method).toBe('GET');
    expect(`${call.url.origin}${call.url.pathname}`).toBe(
      'https://www.storytel.com/api/login.action',
    );
    expect(call.url.searchParams.get('m')).toBe('1');
    expect(call.url.searchParams.get('uid')).toBe(email);
    expect(call.url.searchParams.get('pwd')).toBe(encryptPassword('hunter2'));
    expect(call.url.searchParams.get('version')).toBe('25.38.0');
    expect(call.init.body).toBeUndefined();
    expect(data.accountInfo.jwt).toBe(jwt);
  });

  test('login reply without a jwt throws a non-auth error', async () => {
    let rejected = 0;
    const { fetchImpl } = router({ [LOGIN_PATH]: () => json({ accountInfo: {} }) });
    const client = new StorytelClient({
      fetch: fetchImpl,
      onCredentialsRejected: () => rejected++,
    });

    const error: any = await client.login(uniqueEmail(), 'hunter2').catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Storytel login returned no token');
    expect(error.isStorytelUnauthorized).toBeUndefined();
    expect(rejected).toBe(0);
    expect(client.loginData.accountInfo.jwt).toBe('');
  });

  test('bearer refreshes when jwt expires within 60s', async () => {
    const fresh = makeJwt(3600, 'fresh');
    const { fetchImpl, calls } = router({
      [LOGIN_PATH]: loginOk(fresh),
      [BOOKSHELF_PATH]: () => json({ items: {} }),
    });
    const client = clientWithSession(fetchImpl);
    client.loginData.accountInfo.jwt = makeJwt(30, 'expiring');

    await client.getBookshelf();

    expect(calls.map((c) => c.url.pathname)).toEqual([LOGIN_PATH, BOOKSHELF_PATH]);
    expect(header(calls[1], 'authorization')).toBe(`Bearer ${fresh}`);
  });

  test('401 triggers one refresh and retry', async () => {
    const fresh = makeJwt(3600, 'fresh');
    const { fetchImpl, callsTo } = router({
      [LOGIN_PATH]: loginOk(fresh),
      [BOOKSHELF_PATH]: [
        () => json({ error: 'expired' }, 401),
        () => json({ items: { b1: { action: 'SET', model: { id: 'b1', title: 'Book' } } } }),
      ],
    });
    const client = clientWithSession(fetchImpl);

    const result = await client.getBookshelf();

    expect(callsTo(LOGIN_PATH)).toHaveLength(1);
    const shelfCalls = callsTo(BOOKSHELF_PATH);
    expect(shelfCalls).toHaveLength(2);
    expect(header(shelfCalls[1], 'authorization')).toBe(`Bearer ${fresh}`);
    expect(result.books.map((b) => b.id)).toEqual(['b1']);
  });

  test('second 401 throws StorytelAuthError', async () => {
    const { fetchImpl, callsTo } = router({
      [LOGIN_PATH]: loginOk(makeJwt(3600, 'fresh')),
      [BOOKSHELF_PATH]: () => json({ error: 'expired' }, 401),
    });
    const client = clientWithSession(fetchImpl);

    const error: any = await client.getBookshelf().catch((e) => e);

    expect(error.isStorytelUnauthorized).toBe(true);
    expect(callsTo(BOOKSHELF_PATH)).toHaveLength(2);
    expect(callsTo(LOGIN_PATH)).toHaveLength(1);
  });

  test('rejected re-login calls onCredentialsRejected', async () => {
    let rejected = 0;
    const { fetchImpl } = router({
      [LOGIN_PATH]: () => json({ error: 'bad credentials' }, 401),
      [BOOKSHELF_PATH]: () => json({ error: 'expired' }, 401),
    });
    const client = clientWithSession(fetchImpl, () => rejected++);

    const error: any = await client.getBookshelf().catch((e) => e);

    expect(error.isStorytelUnauthorized).toBe(true);
    expect(rejected).toBe(1);
  });

  test('network error does not call onCredentialsRejected', async () => {
    let rejected = 0;
    const { fetchImpl } = router({
      [LOGIN_PATH]: () => {
        throw new TypeError('fetch failed');
      },
      [BOOKSHELF_PATH]: () => json({ error: 'expired' }, 401),
    });
    const client = clientWithSession(fetchImpl, () => rejected++);

    await expect(client.getBookshelf()).rejects.toBeInstanceOf(Error);
    expect(rejected).toBe(0);
  });

  test('empty jwt and rejected login calls login once and notifies once', async () => {
    let rejected = 0;
    const { fetchImpl, callsTo } = router({
      [LOGIN_PATH]: () => json({ error: 'bad credentials' }, 401),
      [BOOKSHELF_PATH]: () => json({ items: {} }),
    });
    const client = clientWithSession(fetchImpl, () => rejected++);
    client.loginData.accountInfo.jwt = '';

    const error: any = await client.getBookshelf().catch((e) => e);

    expect(error.isStorytelUnauthorized).toBe(true);
    expect(callsTo(LOGIN_PATH)).toHaveLength(1);
    expect(callsTo(BOOKSHELF_PATH)).toHaveLength(0);
    expect(rejected).toBe(1);
  });

  test('expiring jwt and rejected login notifies once', async () => {
    let rejected = 0;
    const { fetchImpl, callsTo } = router({
      [LOGIN_PATH]: () => json({ error: 'bad credentials' }, 401),
      [BOOKSHELF_PATH]: () => json({ error: 'expired' }, 401),
    });
    const client = clientWithSession(fetchImpl, () => rejected++);
    client.loginData.accountInfo.jwt = makeJwt(30, 'expiring');

    const error: any = await client.getBookshelf().catch((e) => e);

    expect(error.isStorytelUnauthorized).toBe(true);
    expect(callsTo(LOGIN_PATH)).toHaveLength(1);
    expect(callsTo(BOOKSHELF_PATH)).toHaveLength(0);
    expect(rejected).toBe(1);
  });

  test('network error during lazy login does not call onCredentialsRejected', async () => {
    let rejected = 0;
    const { fetchImpl } = router({
      [LOGIN_PATH]: () => {
        throw new TypeError('fetch failed');
      },
      [BOOKSHELF_PATH]: () => json({ items: {} }),
    });
    const client = clientWithSession(fetchImpl, () => rejected++);
    client.loginData.accountInfo.jwt = '';

    await expect(client.getBookshelf()).rejects.toBeInstanceOf(Error);
    expect(rejected).toBe(0);
  });

  test('network error during proactive refresh falls back to the current jwt', async () => {
    const expiring = makeJwt(30, 'expiring');
    const { fetchImpl, callsTo } = router({
      [LOGIN_PATH]: () => {
        throw new TypeError('fetch failed');
      },
      [BOOKSHELF_PATH]: () => json({ items: {} }),
    });
    const client = clientWithSession(fetchImpl);
    client.loginData.accountInfo.jwt = expiring;

    await client.getBookshelf();

    expect(header(callsTo(BOOKSHELF_PATH)[0], 'authorization')).toBe(`Bearer ${expiring}`);
  });

  test('concurrent requests share one lazy login', async () => {
    const fresh = makeJwt(3600, 'fresh');
    const { fetchImpl, callsTo } = router({
      [LOGIN_PATH]: loginOk(fresh),
      [BOOKSHELF_PATH]: () => json({ items: {} }),
    });
    const client = clientWithSession(fetchImpl);
    client.loginData.accountInfo.jwt = '';

    await Promise.all([client.getBookshelf(), client.getBookshelf()]);

    expect(callsTo(LOGIN_PATH)).toHaveLength(1);
    expect(callsTo(BOOKSHELF_PATH).map((c) => header(c, 'authorization'))).toEqual([
      `Bearer ${fresh}`,
      `Bearer ${fresh}`,
    ]);
  });

  test('restored client logs in before a URL-token request', async () => {
    const { fetchImpl, calls } = router({
      [LOGIN_PATH]: () =>
        json({ accountInfo: { jwt: makeJwt(3600, 'fresh'), singleSignToken: 'sst-fresh' } }),
      '/mp3streamRangeReq': () =>
        new Response(null, { status: 302, headers: { location: 'https://cdn/legacy.mp3' } }),
    });
    const client = new StorytelClient({ fetch: fetchImpl });
    client.setCredentials(uniqueEmail(), encryptPassword('secret'));

    expect(await client.getStreamUrl('42')).toBe('https://cdn/legacy.mp3');
    expect(calls.map((c) => c.url.pathname)).toEqual([LOGIN_PATH, '/mp3streamRangeReq']);
    expect(calls[1].url.searchParams.get('token')).toBe('sst-fresh');
  });

  test('login and URL-token requests leave no secrets in the logs', async () => {
    const jwt = makeJwt(3600, 'leaky');
    const sst = 'sst-SECRET-123';
    const { fetchImpl } = router({
      [LOGIN_PATH]: () =>
        json({ accountInfo: { jwt, singleSignToken: sst, email: 'leak@example.com' } }),
      '/mp3streamRangeReq': () =>
        new Response(null, { status: 302, headers: { location: 'https://cdn/legacy.mp3' } }),
    });
    const client = new StorytelClient({ fetch: fetchImpl });
    appLogger.clearLogs();

    await client.login('leak@example.com', 'hunter2');
    await client.getStreamUrl('42');

    const dump = JSON.stringify(appLogger.getLogs());
    expect(dump).toContain('mp3streamRangeReq');
    expect(dump).not.toContain(jwt);
    expect(dump).not.toContain(sst);
    expect(dump).not.toContain(encodeURIComponent(sst));
    expect(dump).not.toContain('leak@example.com');
    expect(dump).not.toContain(encodeURIComponent('leak@example.com'));
    expect(dump).not.toMatch(/token=(?!\*\*\*)/);
  });

  test('action log data never keeps credential fields', () => {
    appLogger.clearLogs();
    appLogger.add({
      type: 'action',
      message: 'x',
      data: { email: 'a@b.c', nested: { jwt: 'J', accessToken: 'T' }, bookId: '7' },
    });
    const dump = JSON.stringify(appLogger.getLogs());
    expect(dump).not.toContain('a@b.c');
    expect(dump).not.toContain('"J"');
    expect(dump).not.toContain('"T"');
    expect(dump).toContain('"7"');
  });

  test('stream URL comes from 302 Location', async () => {
    const { fetchImpl, calls } = router({
      '/assets/v2/consumables/c1/abook': () =>
        new Response(null, { status: 302, headers: { location: 'https://cdn/x.mp3' } }),
    });
    const client = clientWithSession(fetchImpl);

    expect(await client.getAudioStreamUrl('c1')).toBe('https://cdn/x.mp3');
    expect(calls[0].init.redirect).toBe('manual');
    expect(header(calls[0], 'authorization')).toBe(`Bearer ${client.loginData.accountInfo.jwt}`);
  });

  test('stream URL errors when Location is missing', async () => {
    const { fetchImpl } = router({
      '/assets/v2/consumables/c1/abook': [
        () => new Response(null, { status: 302 }),
        () => json({ ok: true }),
      ],
      '/mp3streamRangeReq': [() => new Response(null, { status: 302 }), () => json({ ok: true })],
    });
    const client = clientWithSession(fetchImpl);

    for (const attempt of [
      () => client.getAudioStreamUrl('c1'),
      () => client.getAudioStreamUrl('c1'),
      () => client.getStreamUrl('b1'),
      () => client.getStreamUrl('b1'),
    ]) {
      const error = await attempt().catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('stream URL');
    }
  });

  test('bookshelf snapshot posts empty form body', async () => {
    const { fetchImpl, calls } = router({ [BOOKSHELF_PATH]: () => json({ items: {} }) });
    const client = clientWithSession(fetchImpl);

    await client.getBookshelf();

    const [call] = calls;
    expect(call.init.method).toBe('POST');
    expect(call.init.body).toBe('');
    expect(header(call, 'content-type')).toBe('application/x-www-form-urlencoded');
    expect(header(call, 'accept')).toBe('*/*');
    expect(header(call, 'authorization')).toBe(`Bearer ${client.loginData.accountInfo.jwt}`);
  });

  test('bookshelf delta posts JSON', async () => {
    const { fetchImpl, calls } = router({
      [BOOKSHELF_PATH]: [
        () => json({ resourceVersion: 'rv1', items: {} }),
        () => json({ items: { c9: { action: 'SET', model: { id: 'c9' } } } }),
      ],
      '/book-details/consumables/c9': () => json({ title: 'T', authors: [], formats: [] }),
    });
    const client = clientWithSession(fetchImpl);

    const result = await client.addToBookshelf('c9');

    expect(result).toEqual({ added: true, strategy: 'sync-items-map' });
    const delta = calls.filter((c) => c.url.pathname === BOOKSHELF_PATH)[1];
    expect(delta.init.method).toBe('POST');
    expect(header(delta, 'content-type')).toBe('application/json');
    expect(header(delta, 'accept')).toBe('*/*');
    const body = JSON.parse(String(delta.init.body));
    expect(body.resourceVersion).toBe('rv1');
    expect(body.items.c9.action).toBe('SET');
    expect(body.items.c9.model.title).toBe('T');
  });
});

describe('StorytelClient explore', () => {
  const rawBook = (id: string, type = 'abook', order?: number) => ({
    id,
    title: `Book ${id}`,
    authors: [{ name: 'A' }],
    formats: [{ type, cover: { url: `https://c/${id}` } }],
    seriesInfo: order === undefined ? null : { id: '70705', name: 'Saga', orderInSeries: order },
  });
  const CHIPS_PATH = '/explore/frontpage/chips';
  const homePage = {
    title: 'Home',
    nextPageToken: null,
    contentBlocks: [{ id: 'r1', title: 'Row', items: [rawBook('1')] }],
  };

  test('getExplorePage sends the bearer, kidsMode and no store', async () => {
    const { fetchImpl, calls } = router({
      '/explore/pages/frontpage-sthp-pl': () => json(homePage),
    });
    const client = clientWithSession(fetchImpl);

    const page = await client.getExplorePage('frontpage-sthp-pl');

    expect(page.rows.map((r) => r.title)).toEqual(['Row']);
    expect(calls).toHaveLength(1);
    expect(`${calls[0].url.origin}${calls[0].url.pathname}`).toBe(
      'https://api.storytel.net/explore/pages/frontpage-sthp-pl',
    );
    expect(calls[0].url.searchParams.get('kidsMode')).toBe('false');
    expect(header(calls[0], 'authorization')).toStartWith('Bearer ');
    expect(calls[0].url.searchParams.has('store')).toBe(false);
  });

  test('responses are cached per client instance', async () => {
    const { fetchImpl, calls } = router({
      '/explore/pages/home': () => json(homePage),
    });
    const client = clientWithSession(fetchImpl);

    await client.getExplorePage('home');
    await client.getExplorePage('home');
    expect(calls).toHaveLength(1);

    await clientWithSession(fetchImpl).getExplorePage('home');
    expect(calls).toHaveLength(2);
  });

  test('getExploreList rejects foreign urls without fetching', async () => {
    const { fetchImpl, calls } = router({});
    const client = clientWithSession(fetchImpl);

    await expect(client.getExploreList('https://evil.example/x')).rejects.toThrow();
    await expect(client.getExploreList('http://api.storytel.net/explore/x')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test('getExploreList returns audiobooks only', async () => {
    const { fetchImpl } = router({
      '/explore/list-resource/abc': () =>
        json({ title: 'L', totalCount: 2, items: [rawBook('1'), rawBook('2', 'ebook')] }),
    });
    const list = await clientWithSession(fetchImpl).getExploreList(
      'https://api.storytel.net/explore/list-resource/abc?kidsMode=false',
    );
    expect(list.items.map((i) => i.id)).toEqual(['1']);
  });

  test('getExploreChips drops chips without audiobooks', async () => {
    const { fetchImpl, callsTo } = router({
      [CHIPS_PATH]: () =>
        json({
          chips: [
            { id: 'c1', label: 'Home', pageSlug: 'home' },
            { id: 'c2', label: 'Books', pageSlug: 'books-only' },
          ],
        }),
      '/explore/pages/home': () => json(homePage),
      '/explore/pages/books-only': () =>
        json({
          title: 'E',
          contentBlocks: [{ id: 'r', title: 'Row', items: [rawBook('9', 'ebook')] }],
        }),
    });
    const client = clientWithSession(fetchImpl);

    const chips = await client.getExploreChips();
    expect(chips).toEqual([{ id: 'c1', label: 'Home', pageSlug: 'home' }]);

    await client.getExploreChips();
    expect(callsTo('/explore/pages/home')).toHaveLength(1);
    expect(callsTo('/explore/pages/books-only')).toHaveLength(1);
  });

  test('getExploreList forces kidsMode=false and drops store', async () => {
    const { fetchImpl, calls } = router({
      '/explore/list-resource/x': () => json({ title: 'L', items: [] }),
    });
    await clientWithSession(fetchImpl).getExploreList(
      'https://api.storytel.net/explore/list-resource/x?kidsMode=true&store=STHP-SE',
    );
    expect(calls[0].url.searchParams.get('kidsMode')).toBe('false');
    expect(calls[0].url.searchParams.has('store')).toBe(false);
  });

  test('getExploreChips rejects when a probe fails', async () => {
    const { fetchImpl } = router({
      [CHIPS_PATH]: () => json({ chips: [{ id: 'c1', label: 'Home', pageSlug: 'home' }] }),
      '/explore/pages/home': () => {
        throw new Error('network down');
      },
    });
    await expect(clientWithSession(fetchImpl).getExploreChips()).rejects.toThrow();
  });

  test('getExploreChips drops a non-home chip whose page fails and keeps home', async () => {
    const { fetchImpl } = router({
      [CHIPS_PATH]: () =>
        json({
          chips: [
            { id: 'c1', label: 'Home', pageSlug: 'home' },
            { id: 'c2', label: 'Broken', pageSlug: 'broken' },
          ],
        }),
      '/explore/pages/home': () => json(homePage),
      '/explore/pages/broken': () => json({}, 503),
    });
    const chips = await clientWithSession(fetchImpl).getExploreChips();
    expect(chips.map((c) => c.id)).toEqual(['c1']);
  });

  test('getExploreChips rejects on 401 from a non-home chip', async () => {
    const { fetchImpl } = router({
      [CHIPS_PATH]: () =>
        json({
          chips: [
            { id: 'c1', label: 'Home', pageSlug: 'home' },
            { id: 'c2', label: 'Other', pageSlug: 'other' },
          ],
        }),
      '/explore/pages/home': () => json(homePage),
      '/explore/pages/other': () => json({}, 401),
      [LOGIN_PATH]: () => json({}, 401),
    });
    await expect(clientWithSession(fetchImpl).getExploreChips()).rejects.toThrow();
  });

  test('getExploreChips hides podcast and ebook tabs by name', async () => {
    const { fetchImpl, callsTo } = router({
      [CHIPS_PATH]: () =>
        json({
          chips: [
            { id: 'c1', label: 'Home', pageSlug: 'home' },
            { id: 'c2', label: 'Podcasts', pageSlug: 'poland-podcasts-categorypage' },
            { id: 'c3', label: 'eBooks', pageSlug: 'poland-ebooks-categorypage-v2' },
          ],
        }),
      '/explore/pages/home': () => json(homePage),
      '/explore/pages/poland-podcasts-categorypage': () => json(homePage),
      '/explore/pages/poland-ebooks-categorypage-v2': () => json(homePage),
    });
    const chips = await clientWithSession(fetchImpl).getExploreChips();
    expect(chips.map((c) => c.id)).toEqual(['c1']);
    expect(callsTo('/explore/pages/poland-podcasts-categorypage')).toHaveLength(0);
  });

  test('getExploreChips rejects on 401 during probing', async () => {
    const { fetchImpl } = router({
      [CHIPS_PATH]: () => json({ chips: [{ id: 'c1', label: 'Home', pageSlug: 'home' }] }),
      '/explore/pages/home': () => json({}, 401),
    });
    await expect(clientWithSession(fetchImpl).getExploreChips()).rejects.toThrow();
  });

  test('getExploreChips judges a lazy-only page by its first lazy row', async () => {
    const lazyPage = (path: string) => ({
      title: 'P',
      contentBlocks: [
        {
          id: 'l',
          title: 'Lazy',
          itemsUrl: `https://api.storytel.net/explore/list-resource/${path}`,
        },
      ],
    });
    const { fetchImpl } = router({
      [CHIPS_PATH]: () =>
        json({
          chips: [
            { id: 'c1', label: 'Books', pageSlug: 'books' },
            { id: 'c2', label: 'Pods', pageSlug: 'pods' },
          ],
        }),
      '/explore/pages/books': () => json(lazyPage('good')),
      '/explore/pages/pods': () => json(lazyPage('bad')),
      '/explore/list-resource/good': () => json({ title: 'G', items: [rawBook('1')] }),
      '/explore/list-resource/bad': () => json({ title: 'B', items: [rawBook('2', 'ebook')] }),
    });
    const chips = await clientWithSession(fetchImpl).getExploreChips();
    expect(chips.map((c) => c.id)).toEqual(['c1']);
  });

  test('getExploreChips skips lazy rows Storytel answers with a 4xx', async () => {
    const { fetchImpl } = router({
      [CHIPS_PATH]: () =>
        json({
          chips: [
            { id: 'c1', label: 'Home', pageSlug: 'home' },
            { id: 'c2', label: 'Gone', pageSlug: 'gone' },
          ],
        }),
      '/explore/pages/home': () =>
        json({
          title: 'P',
          contentBlocks: [
            {
              id: 'personal',
              title: 'New episodes for you',
              itemsUrl: 'https://api.storytel.net/explore/list-resource/personal',
            },
            {
              id: 'top',
              title: 'Top',
              itemsUrl: 'https://api.storytel.net/explore/list-resource/top',
            },
          ],
        }),
      '/explore/pages/gone': () =>
        json({
          title: 'G',
          contentBlocks: [
            {
              id: 'x',
              title: 'X',
              itemsUrl: 'https://api.storytel.net/explore/list-resource/personal',
            },
          ],
        }),
      '/explore/list-resource/personal': () => json({}, 404),
      '/explore/list-resource/top': () => json({ title: 'T', items: [rawBook('1')] }),
    });
    const chips = await clientWithSession(fetchImpl).getExploreChips();
    expect(chips.map((c) => c.id)).toEqual(['c1']);
  });

  test('getSeries follows pages up to the cap and keeps every format', async () => {
    const { fetchImpl, callsTo } = router({
      '/explore/lists/series/70705': ({ url }) => {
        const n = Number(url.searchParams.get('nextPageToken') ?? 0);
        return json({
          title: 'Saga',
          nextPageToken: String(n + 1),
          items: [rawBook(`p${n}`, n % 2 ? 'ebook' : 'abook', n + 1)],
        });
      },
    });
    const series = await clientWithSession(fetchImpl).getSeries('70705');

    const calls = callsTo('/explore/lists/series/70705');
    expect(calls).toHaveLength(5);
    const query = calls[0].url.searchParams;
    expect(query.get('includeListDetails')).toBe('true');
    expect(query.get('orderBy')).toBe('seriesOrder');
    expect(query.get('kidsMode')).toBe('false');
    expect(query.has('store')).toBe(false);
    expect(calls[1].url.searchParams.get('nextPageToken')).toBe('1');
    expect(series.title).toBe('Saga');
    expect(series.items.map((i) => i.hasAbook)).toEqual([true, false, true, false, true]);
  });

  test('getSeries stops when there is no next page', async () => {
    const { fetchImpl, callsTo } = router({
      '/explore/lists/series/1': () => json({ title: 'S', nextPageToken: null, items: [] }),
    });
    await clientWithSession(fetchImpl).getSeries('1');
    expect(callsTo('/explore/lists/series/1')).toHaveLength(1);
  });
});
