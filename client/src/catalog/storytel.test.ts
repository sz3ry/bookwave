import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

let calls: string[] = [];
let responses: Record<string, unknown> = {};

(globalThis as { window?: unknown }).window = {
  electronApi: {
    get: async (url: string) => {
      calls.push(url);
      return { data: responses[url] };
    },
  },
};

const { storytelCatalog } = await import('./storytel');

afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

beforeEach(() => {
  calls = [];
  responses = {};
});

const details = {
  title: 'Mroczna wieża',
  description: 'Opis',
  language: 'pl',
  category: { name: 'Fantasy' },
  authors: [
    { id: 7, name: 'Stephen King' },
    { id: 8, name: 'Peter Straub' },
  ],
  narrators: [{ name: 'Jan Nowak' }],
  formats: [
    { type: 'ebook', cover: { url: 'https://e.jpg' } },
    { type: 'abook', cover: { url: 'https://a.jpg' }, durationInMilliseconds: 3_600_000 },
  ],
  seriesInfo: { id: 42, name: 'Mroczna wieża', orderInSeries: 3 },
};

describe('storytelCatalog.bookPage', () => {
  test('maps book-details to a book page', async () => {
    responses['/api/book-details/123'] = details;
    const page = await storytelCatalog.bookPage('123');
    expect(calls).toEqual(['/api/book-details/123']);
    expect(page).toEqual({
      book: {
        id: '123',
        title: 'Mroczna wieża',
        authors: 'Stephen King, Peter Straub',
        narrators: 'Jan Nowak',
        coverUrl: 'https://a.jpg',
        category: 'Fantasy',
        durationMs: 3_600_000,
        description: 'Opis',
        hasAbook: true,
        hasEbook: true,
        language: 'pl',
        seriesInfo: { id: '42', name: 'Mroczna wieża', orderInSeries: 3 },
        authorRefs: [
          { id: '7', name: 'Stephen King' },
          { id: '8', name: 'Peter Straub' },
        ],
      },
      inLibrary: false,
      removable: false,
      recommendedAfter: [],
    });
  });

  test('tolerates an empty reply', async () => {
    const page = await storytelCatalog.bookPage('9');
    expect(page.book.id).toBe('9');
    expect(page.book.title).toBe('');
    expect(page.book.seriesInfo).toBeUndefined();
    expect(page.book.hasAbook).toBe(false);
  });

  test('seriesInfo reads the same book page', async () => {
    responses['/api/book-details/123'] = details;
    expect(await storytelCatalog.seriesInfo('123')).toEqual({
      id: '42',
      name: 'Mroczna wieża',
      orderInSeries: 3,
    });
  });
});
