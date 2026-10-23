import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { SearchResultBook } from '../interfaces/books';

type Call = { method: string; url: string; data: unknown };
let calls: Call[] = [];
let responses: Record<string, unknown> = {};

const bridgeMethod =
  (method: string) =>
  async (url: string, data: unknown): Promise<unknown> => {
    calls.push({ method, url, data });
    return { data: responses[`${method} ${url}`] };
  };

(globalThis as { window?: unknown }).window = {
  electronApi: {
    get: bridgeMethod('get'),
    post: bridgeMethod('post'),
    put: bridgeMethod('put'),
    delete: bridgeMethod('delete'),
  },
};

const { audiotekaCatalog } = await import('./audioteka');
const { searchResultToAudiotekaEntry } = await import('../utils/helpers');

afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

beforeEach(() => {
  calls = [];
  responses = {};
});

const BOOK_ID = '0b9f6c3e-1d2a-4c5b-8e7f-123456789abc';

const hit: SearchResultBook = {
  id: BOOK_ID,
  title: 'Ostatnie życzenie',
  authors: 'Andrzej Sapkowski, Jan Kowalski',
  narrators: 'Krzysztof Gosztyła',
  coverUrl: 'https://static.audioteka.com/cover.jpg',
  category: 'Fantasy',
  durationMs: 36_000_000,
  hasAbook: true,
  hasEbook: false,
};

describe('audiotekaCatalog', () => {
  test('searchResultToAudiotekaEntry keeps id, title and duration', () => {
    const entry = searchResultToAudiotekaEntry(hit);
    expect(entry.id).toBe(BOOK_ID);
    expect(entry.title).toBe('Ostatnie życzenie');
    expect(entry.durationMs).toBe(36_000_000);
    expect(entry.authors).toEqual(['Andrzej Sapkowski', 'Jan Kowalski']);
    expect(entry.narrators).toEqual(['Krzysztof Gosztyła']);
    expect(entry.coverUrl).toBe('https://static.audioteka.com/cover.jpg');
    expect(entry.sources).toEqual([]);
    expect(entry.available).toBe(true);
    expect(entry.positionMs).toBeNull();
  });

  test('authorTarget opens the author list when the id is known', () => {
    expect(audiotekaCatalog.authorTarget({ id: 'a-1', name: 'Andrzej Sapkowski' })).toEqual({
      kind: 'list',
      itemsUrl: 'author:a-1',
      title: 'Andrzej Sapkowski',
    });
  });

  test('authorTarget falls back to a search without an id', () => {
    expect(audiotekaCatalog.authorTarget({ name: 'Andrzej Sapkowski' })).toEqual({
      kind: 'search',
      query: 'Andrzej Sapkowski',
    });
  });

  test('playTarget routes to the Audioteka player with autoPlay', () => {
    const target = audiotekaCatalog.playTarget(hit);
    expect(target.path).toBe(`/player/audioteka/${BOOK_ID}`);
    expect(target.state).toEqual({
      audiotekaBook: searchResultToAudiotekaEntry(hit),
      autoPlay: true,
    });
  });

  test('seriesInfo reads the series-info endpoint', async () => {
    responses[`get /api/audioteka/series-info/${BOOK_ID}`] = {
      seriesInfo: { id: 'cycle-1', name: 'Wiedźmin', orderInSeries: 1 },
    };
    const info = await audiotekaCatalog.seriesInfo(BOOK_ID);
    expect(info).toEqual({ id: 'cycle-1', name: 'Wiedźmin', orderInSeries: 1 });
    expect(calls.map((c) => c.url)).toEqual([`/api/audioteka/series-info/${BOOK_ID}`]);
  });

  test('seriesInfo is fetched once per book per session', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    responses[`get /api/audioteka/series-info/${id}`] = { seriesInfo: null };
    expect(await audiotekaCatalog.seriesInfo(id)).toBeNull();
    expect(await audiotekaCatalog.seriesInfo(id)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test('a failed seriesInfo lookup is retried', async () => {
    const id = '99999999-2222-4333-8444-555555555555';
    const bridge = (globalThis as { window: { electronApi: Record<string, unknown> } }).window
      .electronApi;
    const get = bridge.get;
    bridge.get = async () => {
      throw new Error('offline');
    };
    await expect(audiotekaCatalog.seriesInfo(id)).rejects.toThrow();
    bridge.get = get;
    responses[`get /api/audioteka/series-info/${id}`] = {
      seriesInfo: { id: 'c', name: 'C', orderInSeries: 2 },
    };
    expect(await audiotekaCatalog.seriesInfo(id)).toEqual({ id: 'c', name: 'C', orderInSeries: 2 });
  });
});

describe('audiotekaCatalog.bookPage', () => {
  test('returns the server book page as is', async () => {
    const page = { book: hit, inLibrary: true, removable: false, recommendedAfter: [hit] };
    responses[`get /api/audioteka/book-details/${BOOK_ID}`] = page;
    expect(await audiotekaCatalog.bookPage(BOOK_ID)).toEqual(page);
  });
});
