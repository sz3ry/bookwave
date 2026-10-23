import { describe, expect, test } from 'bun:test';
import { toCatalogBook, toHomeRows, toSeries } from './catalog';

const product = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: 'Andrzej Sapkowski',
  image_url: `https://atkcdn.audioteka.com/cc/e4/${id}/4.jpg`,
  tracks_duration_in_ms: 34589780,
  is_available_in_subscription: true,
  cycle_type: null,
  kind: 'Audiobook - pełny',
  categories: [{ id: 'c1', value: 'Fantastyka' }],
  authors: [{ id: 'a1', value: 'Andrzej Sapkowski' }],
  lectors: [{ id: 'l1', value: 'Krzysztof Gosztyła' }],
  ...extra,
});

describe('toCatalogBook', () => {
  test('maps a Club audiobook', () => {
    expect(toCatalogBook(product('b1', 'Rozdroże kruków', { content_language: 'pl' }))).toEqual({
      id: 'b1',
      title: 'Rozdroże kruków',
      authors: 'Andrzej Sapkowski',
      authorRefs: [{ id: 'a1', name: 'Andrzej Sapkowski' }],
      narrators: 'Krzysztof Gosztyła',
      coverUrl: 'https://atkcdn.audioteka.com/cc/e4/b1/4.jpg',
      category: 'Fantastyka',
      durationMs: 34589780,
      hasAbook: true,
      hasEbook: false,
      language: 'pl',
    });
  });

  test('reads embedded authors of an audiobook detail', () => {
    const detail = {
      id: 'b1',
      name: 'Rozdroże kruków',
      is_available_in_subscription: true,
      kind: 'Audiobook - pełny',
      _embedded: {
        'app:author': [{ id: 'a1', name: 'Andrzej Sapkowski' }],
        'app:lector': [{ id: 'l1', name: 'Krzysztof Gosztyła' }],
        'app:category': [{ id: 'c2', name: 'Fantasy' }],
      },
    };
    expect(toCatalogBook(detail)).toMatchObject({
      authors: 'Andrzej Sapkowski',
      authorRefs: [{ id: 'a1', name: 'Andrzej Sapkowski' }],
      narrators: 'Krzysztof Gosztyła',
      category: 'Fantasy',
      coverUrl: '',
      durationMs: 0,
    });
  });

  test('rejects non-Club, podcast and cycle products', () => {
    expect(toCatalogBook(product('x', 'Kupione', { is_available_in_subscription: false }))).toBe(
      null,
    );
    expect(toCatalogBook(product('p', 'Podcast', { kind: 'podcast' }))).toBe(null);
    expect(toCatalogBook(product('c', 'Wiedźmin', { cycle_type: 'generic' }))).toBe(null);
    expect(toCatalogBook({ name: 'no id', is_available_in_subscription: true })).toBe(null);
  });
});

describe('toHomeRows', () => {
  test('keeps only Club audiobooks and drops empty rows', () => {
    const screen = {
      _embedded: {
        'app:screen-section': [
          { id: 'audioteka-hero-pl', type: 'hero', title: null, elements: [] },
          {
            id: 'audioteka-new-audiobooks-pl',
            type: 'product-grid',
            title: 'Nowości',
            _embedded: {
              'app:product': [
                product('b1', 'Jeden'),
                product('b2', 'Dwa'),
                product('b3', 'Kupione', { is_available_in_subscription: false }),
              ],
            },
          },
          {
            id: 'paid-only',
            type: 'product-grid',
            title: 'Tylko do kupienia',
            _embedded: {
              'app:product': [product('b4', 'Cztery', { is_available_in_subscription: false })],
            },
          },
        ],
      },
    };
    const rows = toHomeRows(screen);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('audioteka-new-audiobooks-pl');
    expect(rows[0].title).toBe('Nowości');
    expect(rows[0].items.map((item) => item.id)).toEqual(['b1', 'b2']);
    // No deeplink to a cycle: no "See all" list.
    expect(rows[0].itemsUrl).toBe(null);
  });

  test('toHomeRows uses the cycle deeplink for See all', () => {
    const grid = (id: string, deeplink: unknown) => ({
      id,
      type: 'product-grid',
      title: id,
      deeplink,
      _embedded: { 'app:product': [product(`${id}-b`, 'Jeden')] },
    });
    const rows = toHomeRows({
      _embedded: {
        'app:screen-section': [
          grid(
            'products',
            'https://lstn.link/cycle-products/03ae7be7-5dd3-4010-901c-ccbbc9343f53?catalog=cat-1',
          ),
          grid(
            'cycle',
            'https://lstn.link/cycle/2f902a8c-996b-476f-a8eb-71e8549a7cfd?catalog=cat-1',
          ),
          grid('other', 'https://lstn.link/audiobook/aac673f9-c340-4386-bb56-024b76b5fb85'),
          grid('none', null),
        ],
      },
    });
    expect(rows.map((row) => row.itemsUrl)).toEqual([
      'cycle:03ae7be7-5dd3-4010-901c-ccbbc9343f53',
      'cycle:2f902a8c-996b-476f-a8eb-71e8549a7cfd',
      null,
      null,
    ]);
  });

  test('returns no rows for an unreadable screen', () => {
    expect(toHomeRows(null)).toEqual([]);
    expect(toHomeRows({ _embedded: {} })).toEqual([]);
  });
});

describe('toSeries', () => {
  const parts = [
    product('s1', 'Upadek gigantów'),
    product('s2', 'Zima świata'),
    product('s3', 'Krawędź wieczności'),
  ];

  test('orders parts and ignores generic cycles', () => {
    expect(toSeries({ id: 'w', name: 'Wiedźmin', cycle_type: 'generic' }, parts)).toBe(null);

    const series = toSeries({ id: 'st', name: 'Stulecie', cycle_type: 'series' }, parts, 's2');
    expect(series).not.toBe(null);
    if (!series) return;
    expect(series.title).toBe('Stulecie');
    expect(series.parts.map((part) => [part.id, part.seriesInfo?.orderInSeries])).toEqual([
      ['s1', 1],
      ['s2', 2],
      ['s3', 3],
    ]);
    expect(series.parts[0].seriesInfo).toEqual({ id: 'st', name: 'Stulecie', orderInSeries: 1 });
    expect(series.first?.id).toBe('s1');
    expect(series.firstIsAudiobook).toBe(true);
    expect(series.firstAudiobook?.id).toBe('s1');
    expect(series.next?.id).toBe('s3');
  });

  test('keeps non-Club parts listed but not playable', () => {
    const series = toSeries(
      { id: 'st', name: 'Stulecie', cycle_type: 'series' },
      [product('s1', 'Jeden', { is_available_in_subscription: false }), ...parts.slice(1)],
      undefined,
    );
    expect(series?.parts.map((part) => part.hasAbook)).toEqual([false, true, true]);
    expect(series?.firstIsAudiobook).toBe(false);
    expect(series?.firstAudiobook?.id).toBe('s2');
    expect(series?.next).toBe(null);
  });
});
