import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { BookShelfEntity } from '../interfaces/books';

// The real i18n module boots i18next against the Electron bridge.
mock.module('../i18n', () => ({ default: { t: (key: string) => key } }));

type Call = { method: string; url: string; data: unknown };
let calls: Call[] = [];
let responses: Record<string, unknown> = {};

const bridgeMethod =
  (method: string) =>
  async (url: string, data: unknown): Promise<unknown> => {
    calls.push({ method, url, data });
    const answer = responses[`${method} ${url}`];
    if (answer instanceof Error) {
      return { __isError: true, error: answer.message, statusCode: 500, data: null };
    }
    return { data: answer };
  };

(globalThis as { window?: unknown }).window = {
  electronApi: {
    get: bridgeMethod('get'),
    post: bridgeMethod('post'),
    put: bridgeMethod('put'),
    delete: bridgeMethod('delete'),
  },
};

const { createStorytelSource } = await import('./sources');

const originalWarn = console.warn;
afterAll(() => {
  console.warn = originalWarn;
  delete (globalThis as { window?: unknown }).window;
});

const shelfBook = { book: { consumableId: 'c-42' } } as unknown as BookShelfEntity;

beforeEach(() => {
  calls = [];
  responses = {};
  // The chapter loader warns on each failed endpoint; keep the test output clean.
  console.warn = () => {};
});

describe('createStorytelSource', () => {
  test('keys the book by consumable id with one track of unknown duration', () => {
    const source = createStorytelSource(shelfBook, '7');
    expect(source.provider).toBe('storytel');
    expect(source.bookKey).toBe('c-42');
    expect(source.positionStorageKey).toBe('pos:c-42');
    expect(source.tracks).toEqual([{ id: 'c-42', startMs: 0, durationMs: 0 }]);
    expect(source.remoteWriteIntervalMs).toBe(15000);
    expect(source.conflictPolicy).toBe('newest');
  });

  test('falls back to the book id without a matching shelf entry', () => {
    expect(createStorytelSource(null, '7').positionStorageKey).toBe('pos:7');
  });

  test('resolves the stream through POST /stream', async () => {
    responses['post /api/stream'] = { streamUrl: 'bookwave-media://book/7', remote: false };
    const source = createStorytelSource(shelfBook, '7');
    expect(await source.resolveTrackUrl(0)).toEqual({
      url: 'bookwave-media://book/7',
      remote: false,
    });
    expect(calls).toEqual([
      { method: 'post', url: '/api/stream', data: { bookId: '7', consumableId: 'c-42' } },
    ]);
  });

  test('reads the abook positional bookmark', async () => {
    responses['get /api/bookmark-positional/c-42'] = [
      { type: 'ebook', position: 5, updatedTime: '2026-01-01T00:00:00Z' },
      { type: 'abook', position: 90000, updatedTime: '2026-02-01T00:00:00Z' },
    ];
    const source = createStorytelSource(shelfBook, '7');
    expect(await source.readRemotePosition()).toEqual({
      positionMs: 90000,
      device: null,
      updatedTime: '2026-02-01T00:00:00Z',
    });
  });

  test('reports no remote position without an abook entry, and rejects on API errors', async () => {
    const source = createStorytelSource(shelfBook, '7');
    responses['get /api/bookmark-positional/c-42'] = [];
    expect(await source.readRemotePosition()).toBeNull();

    responses['get /api/bookmark-positional/c-42'] = new Error('offline');
    await expect(source.readRemotePosition()).rejects.toThrow('offline');
  });

  test('writes the position to PUT /bookmark-positional', async () => {
    await createStorytelSource(shelfBook, '7').writeRemotePosition(123000);
    expect(calls).toEqual([
      { method: 'put', url: '/api/bookmark-positional/c-42', data: { position: 123000 } },
    ]);
  });

  test('generates audio tracks from the known duration when no endpoint has chapters', async () => {
    responses['get /api/bookmetadata/c-42'] = new Error('missing');
    responses['get /api/book-details/c-42'] = {};
    const source = createStorytelSource(shelfBook, '7');

    expect(await source.loadChapters(0)).toEqual([]);
    const generated = await source.loadChapters(3600);
    expect(generated.length).toBeGreaterThan(0);
    expect(generated[generated.length - 1].end).toBe(3600);
    expect(calls.map((c) => c.url)).toEqual([
      '/api/bookmetadata/c-42',
      '/api/book-details/c-42',
      '/api/bookmetadata/c-42',
      '/api/book-details/c-42',
    ]);
  });
});
