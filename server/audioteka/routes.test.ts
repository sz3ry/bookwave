import { afterAll, describe, expect, test } from 'bun:test';
import type { FetchLike } from '../http';
import fastify, { audiotekaAuth, configureAudiotekaForTests } from '../testServer';

afterAll(() => {
  audiotekaAuth.logout();
});

const ID = '0a1b2c3d-0000-4000-8000-0123456789ab';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Seen {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function useFetch(handler: (seen: Seen) => Response) {
  const calls: Seen[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const seen: Seen = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.push(seen);
    if (seen.path === '/v2/apps/config/android') {
      return json({ app_version_config: { current_version: '3.60.1' } });
    }
    return handler(seen);
  };
  configureAudiotekaForTests({ fetch: fetchImpl });
  return calls;
}

function login() {
  audiotekaAuth.restore({
    deviceId: 'd',
    refreshId: 'r',
    token: 't',
    expiresAt: '2099-01-01T00:00:00+00:00',
  });
}

describe('Audioteka routes', () => {
  test('401 without a session', async () => {
    audiotekaAuth.logout();
    const res = await fastify.inject({ method: 'GET', url: '/api/audioteka/library' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Not authenticated' });
  });

  test('400 for ids that are not uuids', async () => {
    useFetch(() => json({}));
    login();
    for (const url of [
      '/api/audioteka/books/not-a-uuid',
      '/api/audioteka/tracks/not-a-uuid/url',
      '/api/audioteka/positions/not-a-uuid',
    ]) {
      const res = await fastify.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
    }
  });

  test('library returns merged entries', async () => {
    useFetch(({ path: p }) => {
      if (p === '/v2/me/shelf') {
        return json({
          _embedded: {
            'app:audiobook': [{ id: ID, name: 'Lalka', tracks_duration_in_ms: 60000 }],
          },
        });
      }
      return json({});
    });
    login();
    const res = await fastify.inject({ method: 'GET', url: '/api/audioteka/library' });
    expect(res.statusCode).toBe(200);
    const [entry, ...rest] = res.json();
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({
      id: ID,
      title: 'Lalka',
      durationMs: 60000,
      sources: ['shelf'],
      available: true,
      positionMs: null,
    });
  });

  test('400 for an invalid id on PUT position and POST start', async () => {
    const calls = useFetch(() => json({}));
    login();
    const put = await fastify.inject({
      method: 'PUT',
      url: '/api/audioteka/positions/nope',
      payload: { position: 1 },
    });
    const start = await fastify.inject({ method: 'POST', url: '/api/audioteka/books/nope/start' });
    expect(put.statusCode).toBe(400);
    expect(start.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('a rejected refresh id maps to 401', async () => {
    useFetch(() => json({ message: 'invalid' }, 401));
    audiotekaAuth.restore({
      deviceId: 'd',
      refreshId: 'r',
      token: null,
      expiresAt: null,
    });
    const res = await fastify.inject({ method: 'GET', url: `/api/audioteka/positions/${ID}` });
    expect(res.statusCode).toBe(401);
  });

  test('PUT position rejects a non-numeric body', async () => {
    const calls = useFetch(() => json({}));
    login();
    const res = await fastify.inject({
      method: 'PUT',
      url: `/api/audioteka/positions/${ID}`,
      payload: { position: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('PUT position saves and answers 204', async () => {
    const calls = useFetch(() => json({}));
    login();
    const res = await fastify.inject({
      method: 'PUT',
      url: `/api/audioteka/positions/${ID}`,
      payload: { position: 12345 },
    });
    expect(res.statusCode).toBe(204);
    const command = calls.find((c) => c.path === '/v2/commands');
    expect(command?.body).toMatchObject({
      name: 'SavePlaybackProgress',
      audiobook_id: ID,
      position: 12345,
    });
  });

  test('POST start answers 204', async () => {
    useFetch(() => json({}));
    login();
    const res = await fastify.inject({ method: 'POST', url: `/api/audioteka/books/${ID}/start` });
    expect(res.statusCode).toBe(204);
  });

  test('an upstream 404 keeps its status', async () => {
    useFetch(() => json({ message: 'nope' }, 404));
    login();
    const res = await fastify.inject({ method: 'GET', url: `/api/audioteka/books/${ID}` });
    expect(res.statusCode).toBe(404);
  });

  test('position without a remote record is null', async () => {
    useFetch(() => json({}, 404));
    login();
    const res = await fastify.inject({ method: 'GET', url: `/api/audioteka/positions/${ID}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('null');
  });

  test('Storytel routes stay 401 when only Audioteka is logged in', async () => {
    useFetch(() => json({}));
    login();
    const res = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });
    expect(res.statusCode).toBe(401);
  });

  const hit = (id: string) => ({
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
  });
  const algolia =
    (hits: unknown[], status = 200) =>
    (seen: Seen) => {
      if (seen.path === '/v2/me/algolia') {
        return json({
          index: 'prod_lite_pl_catalog',
          select_facets: [{ name: 'shelf_only', value: 'false' }],
          restrict_facets: [{ name: 'catalog', value: 'cat-1' }],
        });
      }
      if (seen.path.startsWith('/1/indexes/')) return json({ hits }, status);
      return json({});
    };

  test('search returns Club results', async () => {
    useFetch(algolia([hit('h1'), { ...hit('h2'), is_available_in_subscription: false }]));
    login();
    const res = await fastify.inject({ method: 'GET', url: '/api/audioteka/search?q=sapkowski' });
    expect(res.statusCode).toBe(200);
    expect(res.json().results.map((b: { id: string }) => b.id)).toEqual(['h1']);
  });

  test('empty query makes no call', async () => {
    const calls = useFetch(() => json({}));
    login();
    const res = await fastify.inject({ method: 'GET', url: '/api/audioteka/search?q=%20' });
    expect(res.json()).toEqual({ results: [] });
    expect(calls).toHaveLength(0);
  });

  test('rejected search key answers 503', async () => {
    useFetch(algolia([], 403));
    login();
    const res = await fastify.inject({ method: 'GET', url: '/api/audioteka/search?q=x' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'SEARCH_UNAVAILABLE' });
  });

  test('discovery chips and page', async () => {
    useFetch(() => json({}));
    login();
    const chips = await fastify.inject({ method: 'GET', url: '/api/audioteka/discovery/chips' });
    expect(chips.json()).toEqual([{ id: 'home', label: '', pageSlug: 'home' }]);
    const other = await fastify.inject({ method: 'GET', url: '/api/audioteka/discovery/page/x' });
    expect(other.statusCode).toBe(404);
  });

  test('discovery list rejects other urls', async () => {
    const calls = useFetch(() => json({}));
    login();
    for (const url of ['https://evil', 'section:abc', 'author:']) {
      const res = await fastify.inject({
        method: 'GET',
        url: `/api/audioteka/discovery/list?url=${encodeURIComponent(url)}`,
      });
      expect(res.statusCode).toBe(400);
    }
    const bad = await fastify.inject({
      method: 'GET',
      url: '/api/audioteka/discovery/list?url=cycle:abc&nextPageToken=x',
    });
    expect(bad.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('discovery list pages an author', async () => {
    const calls = useFetch(({ path: p }) => {
      if (p === '/v2/me') return json({ id: 'u1', catalog: 'cat-1' });
      return json({ page: 2, pages: 2, total: 1, _embedded: { 'app:product': [hit('h1')] } });
    });
    login();
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/audioteka/discovery/list?url=author:a-1&nextPageToken=2',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((b: { id: string }) => b.id)).toEqual(['h1']);
    expect(calls.some((c) => c.path === '/v2/authors/a-1/products')).toBe(true);
  });

  test('series and book details validate ids', async () => {
    const calls = useFetch(() => json({}));
    login();
    for (const url of [
      '/api/audioteka/discovery/series/nope',
      '/api/audioteka/book-details/nope',
    ]) {
      const res = await fastify.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  test('library add sends AddToFavourites and answers success', async () => {
    const calls = useFetch(() => json({}));
    login();
    const add = await fastify.inject({
      method: 'POST',
      url: '/api/audioteka/library/add',
      payload: { id: ID },
    });
    expect(add.json()).toEqual({ success: true });
    const remove = await fastify.inject({
      method: 'POST',
      url: '/api/audioteka/library/remove',
      payload: { id: ID },
    });
    expect(remove.json()).toEqual({ success: true });
    const names = calls.filter((c) => c.path === '/v2/commands').map((c) => c.body);
    expect(names[0]).toMatchObject({ name: 'AddToFavourites', product_id: ID });
    expect(names[1]).toMatchObject({ name: 'RemoveFromFavourites', product_id: ID });
    const bad = await fastify.inject({
      method: 'POST',
      url: '/api/audioteka/library/add',
      payload: { id: 'x' },
    });
    expect(bad.statusCode).toBe(400);
  });

  test('catalogue routes need an Audioteka session', async () => {
    audiotekaAuth.logout();
    for (const [method, url] of [
      ['GET', '/api/audioteka/search?q=a'],
      ['GET', '/api/audioteka/discovery/chips'],
      ['GET', '/api/audioteka/discovery/page/home'],
      ['GET', '/api/audioteka/discovery/list?url=cycle:a'],
      ['GET', `/api/audioteka/discovery/series/${ID}`],
      ['GET', `/api/audioteka/book-details/${ID}`],
      ['POST', '/api/audioteka/library/add'],
      ['POST', '/api/audioteka/library/remove'],
    ] as const) {
      const res = await fastify.inject({ method, url });
      expect(res.statusCode).toBe(401);
    }
  });
});
