import { describe, expect, test } from 'bun:test';
import type { FetchLike } from '../http';
import {
  ALGOLIA_APP_ID,
  ALGOLIA_SEARCH_KEY,
  AudiotekaSearchUnavailableError,
  searchAlgolia,
} from './search';

const CONFIG = { index: 'prod_lite_pl_catalog', filters: "catalog:'cat-1' AND shelf_only:'false'" };

describe('searchAlgolia', () => {
  test('sends query, filters and hitsPerPage 50', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchImpl: FetchLike = async (input, init) => {
      seen = { url: String(input), init };
      return new Response(JSON.stringify({ hits: [{ id: 'h1' }, { id: 'h2' }] }), { status: 200 });
    };

    const hits = await searchAlgolia('sapkowski', CONFIG, fetchImpl);

    expect(hits).toEqual([{ id: 'h1' }, { id: 'h2' }]);
    if (!seen) throw new Error('no request');
    const { url, init } = seen as { url: string; init?: RequestInit };
    expect(url).toBe(
      `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/prod_lite_pl_catalog/query`,
    );
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-algolia-application-id']).toBe(ALGOLIA_APP_ID);
    expect(headers['x-algolia-api-key']).toBe(ALGOLIA_SEARCH_KEY);
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'sapkowski',
      filters: CONFIG.filters,
      hitsPerPage: 50,
    });
  });

  test('rejected search key throws AudiotekaSearchUnavailableError', async () => {
    for (const status of [401, 403]) {
      const fetchImpl: FetchLike = async () => new Response('{}', { status });
      await expect(searchAlgolia('x', CONFIG, fetchImpl)).rejects.toBeInstanceOf(
        AudiotekaSearchUnavailableError,
      );
    }
  });

  test('other failures are plain errors', async () => {
    const fetchImpl: FetchLike = async () => new Response('{}', { status: 500 });
    const error = await searchAlgolia('x', CONFIG, fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AudiotekaSearchUnavailableError);
  });
});
