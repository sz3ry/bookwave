import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { BookShelfEntity } from '../interfaces/books';
import type { AudiotekaLibraryEntry, AudiotekaTrack } from '../interfaces/library';

// The real i18n module boots i18next against the Electron bridge.
mock.module('../i18n', () => ({
  default: {
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  },
}));

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

const { createAudiotekaSource, createStorytelSource } = await import('./sources');

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
    expect(source.conflictPolicy).toBe('follow');
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

  test('a guarded write sends ifRemoteAt and reports a skip', async () => {
    const source = createStorytelSource(shelfBook, '7');
    responses['put /api/bookmark-positional/c-42'] = { skipped: true };
    expect(await source.writeRemotePosition(123000, 50000)).toBe(false);
    expect(calls.at(-1)).toEqual({
      method: 'put',
      url: '/api/bookmark-positional/c-42',
      data: { position: 123000, ifRemoteAt: 50000 },
    });
    responses['put /api/bookmark-positional/c-42'] = {};
    expect(await source.writeRemotePosition(123000, 50000)).toBe(true);
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

const BOOK_ID = '0f8c5a52-1111-4222-8333-944445555666';
const entry: AudiotekaLibraryEntry = {
  id: BOOK_ID,
  title: 'Book',
  authors: ['Author'],
  narrators: [],
  coverUrl: null,
  durationMs: 300000,
  sources: ['shelf'],
  available: true,
  positionMs: null,
};
const trackId = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
// Deliberately out of order: the source orders tracks by index.
const tracks: AudiotekaTrack[] = [
  { id: trackId(2), index: 2, durationMs: 100000, startMs: 200000 },
  { id: trackId(0), index: 0, durationMs: 120000, startMs: 0 },
  { id: trackId(1), index: 1, durationMs: 80000, startMs: 120000 },
];
const urlPath = (n: number) => `get /api/audioteka/tracks/${trackId(n)}/url`;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createAudiotekaSource', () => {
  test('keys the book under pos:audioteka with the ordered track timeline', () => {
    const source = createAudiotekaSource(entry, tracks);
    expect(source.provider).toBe('audioteka');
    expect(source.bookKey).toBe(BOOK_ID);
    expect(source.positionStorageKey).toBe(`pos:audioteka:${BOOK_ID}`);
    expect(source.tracks).toEqual([
      { id: trackId(0), startMs: 0, durationMs: 120000 },
      { id: trackId(1), startMs: 120000, durationMs: 80000 },
      { id: trackId(2), startMs: 200000, durationMs: 100000 },
    ]);
    expect(source.remoteWriteIntervalMs).toBe(60000);
    expect(source.conflictPolicy).toBe('ask');
  });

  test('resolves a track URL as remote, prefetches the next one and serves both from the cache', async () => {
    let now = 1_000_000;
    responses[urlPath(0)] = { url: 'https://cdn/0.mp3', expiresAt: now + 10_800_000 };
    responses[urlPath(1)] = { url: 'https://cdn/1.mp3', expiresAt: now + 10_800_000 };
    const source = createAudiotekaSource(entry, tracks, () => now);

    expect(await source.resolveTrackUrl(0)).toEqual({ url: 'https://cdn/0.mp3', remote: true });
    await flush();
    expect(calls.map((c) => c.url)).toEqual([
      `/api/audioteka/tracks/${trackId(0)}/url`,
      `/api/audioteka/tracks/${trackId(1)}/url`,
    ]);

    responses[urlPath(2)] = { url: 'https://cdn/2.mp3', expiresAt: now + 10_800_000 };
    calls = [];
    now += 60_000;
    expect(await source.resolveTrackUrl(1)).toEqual({ url: 'https://cdn/1.mp3', remote: true });
    await flush();
    // Track 1 came from the cache; only the prefetch of track 2 went out
    expect(calls.map((c) => c.url)).toEqual([`/api/audioteka/tracks/${trackId(2)}/url`]);
  });

  test('asks again for an invalidated or expiring URL', async () => {
    let now = 0;
    responses[urlPath(2)] = { url: 'https://cdn/2-a.mp3', expiresAt: 10_800_000 };
    const source = createAudiotekaSource(entry, tracks, () => now);
    await source.resolveTrackUrl(2);

    responses[urlPath(2)] = { url: 'https://cdn/2-b.mp3', expiresAt: 21_600_000 };
    source.invalidateTrackUrl?.(2);
    expect((await source.resolveTrackUrl(2)).url).toBe('https://cdn/2-b.mp3');

    responses[urlPath(2)] = { url: 'https://cdn/2-c.mp3', expiresAt: 32_400_000 };
    now = 21_600_000 - 60_000;
    expect((await source.resolveTrackUrl(2)).url).toBe('https://cdn/2-c.mp3');
  });

  test('shares one request when a prefetch and a resolve overlap', async () => {
    responses[urlPath(0)] = { url: 'https://cdn/0.mp3', expiresAt: Date.now() + 10_800_000 };
    responses[urlPath(1)] = { url: 'https://cdn/1.mp3', expiresAt: Date.now() + 10_800_000 };
    const source = createAudiotekaSource(entry, tracks);
    await Promise.all([source.resolveTrackUrl(0), source.resolveTrackUrl(1)]);
    await flush();
    expect(calls.filter((c) => c.url.endsWith(`${trackId(1)}/url`))).toHaveLength(1);
  });

  test('rejects a track index outside the timeline', async () => {
    await expect(createAudiotekaSource(entry, tracks).resolveTrackUrl(3)).rejects.toThrow();
  });

  test('reads and writes the remote position in ms', async () => {
    const source = createAudiotekaSource(entry, tracks);
    responses[`get /api/audioteka/positions/${BOOK_ID}`] = { positionMs: 90000, device: 'Pixel' };
    expect(await source.readRemotePosition()).toEqual({ positionMs: 90000, device: 'Pixel' });

    responses[`get /api/audioteka/positions/${BOOK_ID}`] = null;
    expect(await source.readRemotePosition()).toBeNull();

    await source.writeRemotePosition(123456);
    expect(calls.at(-1)).toEqual({
      method: 'put',
      url: `/api/audioteka/positions/${BOOK_ID}`,
      data: { position: 123456 },
    });
  });

  test('has one chapter per track titled as a part', async () => {
    expect(await createAudiotekaSource(entry, tracks).loadChapters(0)).toEqual([
      { number: 1, title: 'player.part {"n":1}', start: 0, end: 120, durationInSeconds: 120 },
      { number: 2, title: 'player.part {"n":2}', start: 120, end: 200, durationInSeconds: 80 },
      { number: 3, title: 'player.part {"n":3}', start: 200, end: 300, durationInSeconds: 100 },
    ]);
  });

  test('reports the playback start once per source', async () => {
    const source = createAudiotekaSource(entry, tracks);
    source.onPlaybackStarted?.();
    source.onPlaybackStarted?.();
    await flush();
    expect(calls).toEqual([
      { method: 'post', url: `/api/audioteka/books/${BOOK_ID}/start`, data: null },
    ]);
  });
});
