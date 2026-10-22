import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDownloadsIndex } from './downloadsIndex';
import type { FetchLike } from './http/storytelFetch';
import { encryptPassword } from './passwordCrypt';

// fastify-common creates its downloads directory and the logger reads its log
// file at import time, so point both at a temporary directory first.
// The variables are restored afterwards so other test files do not see them.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookwave-routes-'));
const testEnv = {
  IS_ELECTRON: 'true',
  DOWNLOAD_PATH: tmpDir,
  USER_DATA_PATH: tmpDir,
  NODE_ENV: 'production', // silences the Fastify request logger
};
const savedEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));
Object.assign(process.env, testEnv);

const {
  default: fastify,
  auth,
  configureSessionForTests,
  resolveDownloadedFile,
} = await import('./fastify-common');

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const LOGIN_PATH = '/api/login.action';
const BOOKSHELF_PATH = '/libraries/bookshelf';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = `${b64url({ alg: 'none' })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

function useFetch(routes: Record<string, () => Response>) {
  const fetchImpl: FetchLike = async (input) => {
    const { pathname } = new URL(String(input));
    const route = routes[pathname];
    if (!route) throw new Error(`unexpected request to ${pathname}`);
    return route();
  };
  configureSessionForTests({ fetch: fetchImpl });
}

const creds = { email: 'reader@example.com', encryptedPassword: encryptPassword('secret') };

// The server keeps its downloads index in USER_DATA_PATH; tests read and seed
// the same file.
const indexPath = path.join(tmpDir, 'downloads-index.json');
const downloadsIndex = createDownloadsIndex(indexPath);

// Fetch stub for routes that must answer from local data only.
function useNoNetwork() {
  const calls: string[] = [];
  configureSessionForTests({
    fetch: async (input) => {
      calls.push(String(input));
      throw new TypeError('fetch failed');
    },
  });
  return calls;
}

function writeBookFile(bookId: string, title = 'Lalka') {
  const filePath = path.join(tmpDir, `${title} [${bookId}].mp3`);
  fs.writeFileSync(filePath, 'mp3');
  return filePath;
}

const shelfEntry = (bookId: string, name: string) => ({
  id: `c${bookId}`,
  status: 2,
  book: { name, authorsAsString: 'Bolesław Prus', consumableId: `c${bookId}`, largeCover: '' },
  abook: { id: bookId, narratorAsString: '', time: 1000, description: '' },
  abookMark: { pos: 10 },
  ebook: null,
});

afterEach(() => {
  auth.logout();
  fs.rmSync(indexPath, { force: true });
  for (const name of fs.readdirSync(tmpDir)) {
    if (name.endsWith('.mp3')) fs.rmSync(path.join(tmpDir, name), { force: true });
  }
});

// The fastify instance is not closed here: bun runs all test files in one
// process and server/audioteka/routes.test.ts injects into the same instance.
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('routes', () => {
  test('routes return 401 without session', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Not authenticated' });
  });

  test('routes use the restored session', async () => {
    useFetch({
      [LOGIN_PATH]: () => json({ accountInfo: { jwt, singleSignToken: 'sst' } }),
      [BOOKSHELF_PATH]: () => json({ items: {} }),
    });
    auth.restore(creds);

    const response = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ books: [] });
  });

  test('network error does not reject credentials', async () => {
    useFetch({
      [LOGIN_PATH]: () => {
        throw new TypeError('fetch failed');
      },
      [BOOKSHELF_PATH]: () => {
        throw new TypeError('fetch failed');
      },
    });
    auth.restore(creds);

    const response = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(auth.getState().loggedIn).toBe(true);
  });

  test('rejected credentials end the session and reply 401', async () => {
    useFetch({
      [LOGIN_PATH]: () => json({ error: 'bad credentials' }, 401),
    });
    auth.restore(creds);
    let notified = 0;
    const unsubscribe = auth.onCredentialsRejected(() => notified++);

    const response = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });
    unsubscribe();

    expect(response.statusCode).toBe(401);
    expect(notified).toBe(1);
    expect(auth.getState()).toEqual({ loggedIn: false, email: null });
  });

  test('local download routes need a session but no Storytel call', async () => {
    useFetch({});
    const without = await fastify.inject({ method: 'GET', url: '/api/download-status/123' });
    expect(without.statusCode).toBe(401);

    auth.restore(creds);
    const response = await fastify.inject({ method: 'GET', url: '/api/download-status/123' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ downloaded: false });
  });

  test('stream of a downloaded book points at the media protocol', async () => {
    const bookId = '5134609';
    const filePath = path.join(tmpDir, `Lalka [${bookId}].mp3`);
    fs.writeFileSync(filePath, 'mp3');
    useFetch({});
    auth.restore(creds);

    try {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/stream',
        payload: { bookId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        streamUrl: `bookwave-media://book/${bookId}`,
        remote: false,
      });
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });

  test('downloaded files resolve by book id only', () => {
    const bookId = '5134610';
    const filePath = path.join(tmpDir, `Lalka [${bookId}].mp3`);
    fs.writeFileSync(filePath, 'mp3');

    try {
      expect(resolveDownloadedFile(bookId)).toBe(filePath);
      expect(resolveDownloadedFile('999')).toBeNull();
      expect(resolveDownloadedFile('../etc')).toBeNull();
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });

  test('offline bookshelf lists indexed books whose file exists, without Storytel', async () => {
    writeBookFile('701', 'Lalka');
    downloadsIndex.upsert('701', shelfEntry('701', 'Lalka'));
    downloadsIndex.upsert('702', shelfEntry('702', 'Deleted from disk'));
    const calls = useNoNetwork();
    auth.restore(creds);

    const response = await fastify.inject({ method: 'GET', url: '/api/offline/bookshelf' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ books: [shelfEntry('701', 'Lalka')] });
    expect(calls).toEqual([]);
  });

  test('offline bookshelf needs a session', async () => {
    useNoNetwork();
    const response = await fastify.inject({ method: 'GET', url: '/api/offline/bookshelf' });

    expect(response.statusCode).toBe(401);
  });

  test('bookshelf indexes books that are already downloaded', async () => {
    writeBookFile('801', 'Lalka');
    useFetch({
      [LOGIN_PATH]: () => json({ accountInfo: { jwt, singleSignToken: 'sst' } }),
      [BOOKSHELF_PATH]: () =>
        json({
          items: {
            c801: {
              action: 'SET',
              model: {
                id: 'c801',
                title: 'Lalka',
                state: 'CONSUMING',
                authors: [{ id: 'a', name: 'Bolesław Prus' }],
                formats: [{ id: '801', type: 'abook', durationInMilliseconds: 1000 }],
              },
            },
            c802: {
              action: 'SET',
              model: {
                id: 'c802',
                title: 'Not downloaded',
                state: 'WILL_CONSUME',
                formats: [{ id: '802', type: 'abook' }],
              },
            },
          },
        }),
    });
    auth.restore(creds);

    const online = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });
    expect(online.statusCode).toBe(200);
    const lalka = online.json().books.find((b: { id: string }) => b.id === 'c801');

    expect(downloadsIndex.list()).toEqual([{ bookId: '801', entry: lalka }]);
  });

  test('already downloaded book is indexed with the entry the client sent', async () => {
    writeBookFile('901', 'Lalka');
    useNoNetwork();
    auth.restore(creds);
    const entry = shelfEntry('901', 'Lalka');

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/download',
      payload: { bookId: '901', consumableId: 'c901', book: entry },
    });

    expect(response.statusCode).toBe(200);
    expect(downloadsIndex.list()).toEqual([{ bookId: '901', entry }]);
  });

  test('download does not index an entry that belongs to another book', async () => {
    writeBookFile('902', 'Lalka');
    useNoNetwork();
    auth.restore(creds);

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/download',
      payload: { bookId: '902', consumableId: 'c903', book: shelfEntry('903', 'Potop') },
    });

    expect(response.statusCode).toBe(200);
    expect(downloadsIndex.list()).toEqual([]);
  });

  test('deleting a downloaded file drops it from the index', async () => {
    writeBookFile('1001', 'Lalka');
    downloadsIndex.upsert('1001', shelfEntry('1001', 'Lalka'));
    downloadsIndex.upsert('1002', shelfEntry('1002', 'Potop'));
    useNoNetwork();
    auth.restore(creds);

    const response = await fastify.inject({ method: 'DELETE', url: '/api/downloaded-file/1001' });

    expect(response.statusCode).toBe(200);
    expect(downloadsIndex.list().map((item) => item.bookId)).toEqual(['1002']);
  });

  test('translations stay public', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/api/translations?lang=en' });

    expect(response.statusCode).toBe(200);
  });

  test('Polish translations are served, region variants included', async () => {
    const english = await fastify.inject({ method: 'GET', url: '/api/translations?lang=en' });

    for (const lang of ['pl', 'pl-PL']) {
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/translations?lang=${lang}`,
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-language']).toBe('pl');
      expect(body.login.title).toBeString();
      expect(body.login.title).not.toBe(english.json().login.title);
    }
  });

  test('JWT auth routes are gone', async () => {
    for (const [method, url] of [
      ['POST', '/api/login'],
      ['POST', '/api/logout'],
      ['GET', '/api/auth/status'],
      ['GET', '/api/account'],
    ] as const) {
      const response = await fastify.inject({ method, url });
      expect(response.statusCode).toBe(404);
    }
  });
});

describe('discovery routes', () => {
  const abook = (id: string) => ({ type: 'abook', id: `a${id}`, durationInMilliseconds: 60000 });
  const rawBook = (id: string, order: number, type = 'abook') => ({
    id,
    title: `Book ${id}`,
    authors: [{ name: 'Author' }],
    formats: [type === 'abook' ? abook(id) : { type: 'ebook', id: `e${id}` }],
    seriesInfo: { id: '70705', name: 'Saga', orderInSeries: order },
  });
  const loginRoute = () => json({ accountInfo: { jwt, singleSignToken: 'sst' } });

  test('every route returns 401 without a session', async () => {
    for (const url of [
      '/api/discovery/chips',
      '/api/discovery/page/x',
      '/api/discovery/list?url=https://api.storytel.net/explore/lists/x',
      '/api/discovery/series/1',
    ]) {
      const response = await fastify.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
    }
  });

  test('list rejects urls outside api.storytel.net/explore', async () => {
    const calls = useNoNetwork();
    auth.restore(creds);
    for (const bad of [
      'https://evil.example/x',
      'https://api.storytel.net/bookmarks/1',
      'http://api.storytel.net/explore/lists/x',
    ]) {
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/discovery/list?url=${encodeURIComponent(bad)}`,
      });
      expect(response.statusCode).toBe(400);
    }
    const missing = await fastify.inject({ method: 'GET', url: '/api/discovery/list' });
    expect(missing.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('rejects malformed series ids, page slugs and book ids with 400', async () => {
    useFetch({ [LOGIN_PATH]: loginRoute });
    auth.restore(creds);
    for (const url of [
      '/api/discovery/series/abc',
      '/api/discovery/series/1%2F..%2Fx',
      '/api/discovery/page/a%2Fb',
      '/api/discovery/page/a.b',
      '/api/book-details/abc',
      '/api/book-details/1%3Fx',
    ]) {
      const response = await fastify.inject({ method: 'GET', url });
      expect({ url, status: response.statusCode }).toEqual({ url, status: 400 });
    }
  });

  test('page maps items to search results with seriesInfo', async () => {
    useFetch({
      [LOGIN_PATH]: loginRoute,
      '/explore/pages/home': () =>
        json({
          title: 'Home',
          nextPageToken: 'n1',
          contentBlocks: [
            { id: 'r1', title: 'Row', items: [rawBook('1', 2), rawBook('2', 1, 'ebook')] },
            { id: 'r2', title: 'Lazy', itemsUrl: 'https://api.storytel.net/explore/lists/z' },
          ],
        }),
    });
    auth.restore(creds);

    const response = await fastify.inject({ method: 'GET', url: '/api/discovery/page/home' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.nextPageToken).toBe('n1');
    expect(body.rows[0].items).toHaveLength(1);
    expect(body.rows[0].items[0]).toMatchObject({
      id: '1',
      authors: 'Author',
      hasAbook: true,
      durationMs: 60000,
      seriesInfo: { id: '70705', name: 'Saga', orderInSeries: 2 },
    });
    expect(body.rows[1]).toMatchObject({
      items: [],
      itemsUrl: 'https://api.storytel.net/explore/lists/z',
    });
  });

  test('list returns mapped audiobooks', async () => {
    useFetch({
      [LOGIN_PATH]: loginRoute,
      '/explore/lists/z': () => json({ title: 'L', totalCount: 1, items: [rawBook('1', 1)] }),
    });
    auth.restore(creds);

    const url = encodeURIComponent('https://api.storytel.net/explore/lists/z');
    const response = await fastify.inject({ method: 'GET', url: `/api/discovery/list?url=${url}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ title: 'L', totalCount: 1, items: [{ id: '1' }] });
  });

  test('series returns the next audiobook part after current', async () => {
    useFetch({
      [LOGIN_PATH]: loginRoute,
      '/explore/lists/series/70705': () =>
        json({
          title: 'Saga',
          items: [
            rawBook('13', 3),
            rawBook('11', 1, 'ebook'),
            rawBook('12', 2),
            rawBook('14', 4, 'ebook'),
          ],
        }),
    });
    auth.restore(creds);

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/discovery/series/70705?current=2',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.next.seriesInfo.orderInSeries).toBe(3);
    expect(body.next.id).toBe('13');
    expect(body.firstIsAudiobook).toBe(false);
    expect(body.first.id).toBe('11');
    expect(body.firstAudiobook.id).toBe('12');
    expect(body.parts.map((p: any) => p.id)).toEqual(['11', '12', '13', '14']);
    expect(body.parts[0].hasAbook).toBe(false);
  });

  test('a re-login refetches instead of serving the previous account cache', async () => {
    let served = 0;
    useFetch({
      [LOGIN_PATH]: loginRoute,
      '/explore/pages/x': () => {
        served += 1;
        return json({ title: `T${served}`, contentBlocks: [] });
      },
    });
    auth.restore(creds);
    const first = await fastify.inject({ method: 'GET', url: '/api/discovery/page/x' });
    const again = await fastify.inject({ method: 'GET', url: '/api/discovery/page/x' });
    expect(again.json().title).toBe(first.json().title);

    auth.logout();
    auth.restore({ email: 'other@example.com', encryptedPassword: encryptPassword('pw') });
    const other = await fastify.inject({ method: 'GET', url: '/api/discovery/page/x' });

    expect(served).toBe(2);
    expect(other.json().title).toBe('T2');
  });

  test('search and bookshelf carry seriesInfo', async () => {
    useFetch({
      [LOGIN_PATH]: loginRoute,
      '/search/v2': () => json({ items: [rawBook('5', 3)] }),
      [BOOKSHELF_PATH]: () =>
        json({
          items: {
            '5': {
              action: 'add',
              model: {
                id: '5',
                title: 'Book 5',
                state: 'WILL_CONSUME',
                formats: [abook('5')],
                seriesInfo: { id: '70705', name: 'Saga', orderInSeries: 3, deepLink: 'x' },
              },
            },
          },
        }),
    });
    auth.restore(creds);

    const search = await fastify.inject({ method: 'GET', url: '/api/search?q=book' });
    expect(search.json().results[0].seriesInfo).toEqual({
      id: '70705',
      name: 'Saga',
      orderInSeries: 3,
    });
    const shelf = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });
    expect(shelf.json().books[0].book.seriesInfo).toEqual({
      id: '70705',
      name: 'Saga',
      orderInSeries: 3,
    });
  });

  test('search marks unreleased audiobooks as coming soon', async () => {
    const upcoming = rawBook('6', 2);
    upcoming.formats = [
      { ...abook('6'), isReleased: false, releaseDate: '2026-12-14T00:00:00Z' } as any,
    ];
    useFetch({
      [LOGIN_PATH]: loginRoute,
      '/search/v2': () => json({ items: [rawBook('5', 1), upcoming] }),
    });
    auth.restore(creds);

    const [released, unreleased] = (
      await fastify.inject({ method: 'GET', url: '/api/search?q=book' })
    ).json().results;
    expect(released.comingSoon).toBe(false);
    expect(unreleased.comingSoon).toBe(true);
    expect(unreleased.releaseDate).toBe('2026-12-14T00:00:00Z');
  });
});
