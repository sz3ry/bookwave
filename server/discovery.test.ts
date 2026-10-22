import { describe, expect, test } from 'bun:test';
import {
  createTtlCache,
  type DiscoveryItem,
  isAllowedExploreUrl,
  pickSeriesParts,
  playableOnly,
  toDiscoveryItem,
  toDiscoveryList,
  toDiscoveryPage,
} from './discovery';

const rawItem = (id: string, formats: string[], order?: number | null, seriesId = 's1') => ({
  id,
  title: `Book ${id}`,
  authors: [{ id: '1', name: 'Jane Doe' }],
  formats: formats.map((type) => ({
    id: `${id}-${type}`,
    type,
    cover: { url: `https://c/${id}` },
  })),
  seriesInfo: order === undefined ? null : { id: seriesId, name: 'Saga', orderInSeries: order },
});

const item = (id: string, hasAbook: boolean, order: number | null): DiscoveryItem => {
  const mapped = toDiscoveryItem(rawItem(id, hasAbook ? ['abook'] : ['ebook'], order));
  if (!mapped) throw new Error('fixture');
  return mapped;
};

describe('toDiscoveryItem', () => {
  test('maps authors, cover, series and format', () => {
    const mapped = toDiscoveryItem(rawItem('7', ['ebook', 'abook'], 2));
    expect(mapped).toMatchObject({
      id: '7',
      title: 'Book 7',
      authors: ['Jane Doe'],
      coverUrl: 'https://c/7',
      hasAbook: true,
      seriesInfo: { id: 's1', name: 'Saga', orderInSeries: 2 },
    });
    expect(mapped?.raw).toBeDefined();
  });

  test('returns null without id or title', () => {
    expect(toDiscoveryItem({ title: 'x' })).toBeNull();
    expect(toDiscoveryItem({ id: '1' })).toBeNull();
    expect(toDiscoveryItem(null)).toBeNull();
  });
});

describe('isAllowedExploreUrl', () => {
  test('accepts only https explore urls on api.storytel.net', () => {
    expect(
      isAllowedExploreUrl('https://api.storytel.net/explore/list-resource/abc?kidsMode=false'),
    ).toBe(true);
    expect(isAllowedExploreUrl('http://api.storytel.net/explore/x')).toBe(false);
    expect(isAllowedExploreUrl('https://api.storytel.net/bookmarks/manual')).toBe(false);
    expect(isAllowedExploreUrl('https://api.storytel.net.evil.com/explore/x')).toBe(false);
    expect(isAllowedExploreUrl('https://evil.example/explore/x')).toBe(false);
    expect(isAllowedExploreUrl('not a url')).toBe(false);
    expect(isAllowedExploreUrl('https://user:pw@api.storytel.net/explore/x')).toBe(false);
    expect(isAllowedExploreUrl('https://api.storytel.net/explore/..%2Fbookmarks')).toBe(false);
    expect(isAllowedExploreUrl('https://api.storytel.net/explore/a%5Cb')).toBe(false);
    expect(isAllowedExploreUrl('https://api.storytel.net/explore/%2e%2e/x')).toBe(false);
  });
});

describe('toDiscoveryPage', () => {
  const page = {
    title: 'Home',
    nextPageToken: 'tok',
    contentBlocks: [
      {
        id: 'a',
        title: 'Lazy row',
        displayType: 'horizontalList',
        itemsUrl: 'https://api.storytel.net/explore/list-resource/abc?kidsMode=false',
      },
      {
        id: 'b',
        title: 'Inline row',
        displayType: 'horizontalList',
        items: [rawItem('1', ['abook']), rawItem('2', ['ebook'])],
      },
      { id: 'c', displayType: 'bannerCarousel', items: [rawItem('3', ['abook'])] },
      { id: 'd', title: 'Banner', displayType: 'bannerCarousel', items: [rawItem('4', ['abook'])] },
    ],
  };

  test('keeps titled non-banner rows and drops ebook-only inline items', () => {
    const result = toDiscoveryPage(page);
    expect(result.title).toBe('Home');
    expect(result.nextPageToken).toBe('tok');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].itemsUrl).toContain('/explore/list-resource/abc');
    expect(result.rows[0].items).toEqual([]);
    expect(result.rows[1].itemsUrl).toBeNull();
    expect(result.rows[1].items.map((i) => i.id)).toEqual(['1']);
  });
});

describe('toDiscoveryList', () => {
  test('maps items, count and token', () => {
    const list = toDiscoveryList({
      title: 'T',
      totalCount: 12,
      nextPageToken: null,
      items: [rawItem('1', ['abook']), { nope: true }],
    });
    expect(list).toMatchObject({ title: 'T', totalCount: 12, nextPageToken: null });
    expect(list.items).toHaveLength(1);
  });
});

describe('playableOnly', () => {
  test('drops ebook-only items', () => {
    expect(playableOnly([item('1', true, 1), item('2', false, 2)]).map((i) => i.id)).toEqual(['1']);
  });
});

describe('pickSeriesParts', () => {
  const items = [
    item('c', true, 3),
    item('a', false, 1),
    item('b1', true, 2),
    item('n', true, null),
    item('b2', true, 2),
  ];
  const order = (i: DiscoveryItem | null) => i?.seriesInfo?.orderInSeries ?? null;

  test('part 1 is ebook-only: offers the first audiobook and the next part', () => {
    const result = pickSeriesParts(items, 2);
    expect(order(result.first)).toBe(1);
    expect(result.firstIsAudiobook).toBe(false);
    expect(result.firstAudiobook?.id).toBe('b1');
    expect(result.next?.id).toBe('c');
    expect(result.parts.map((p) => p.id)).toEqual(['a', 'b1', 'b2', 'c', 'n']);
  });

  test('last part has no next', () => {
    expect(pickSeriesParts(items, 3).next).toBeNull();
  });

  test('unknown current order has no next', () => {
    expect(pickSeriesParts(items, null).next).toBeNull();
  });

  test('audiobook part 1 is both first and firstAudiobook', () => {
    const result = pickSeriesParts([item('x', true, 1), item('y', true, 2)], 1);
    expect(result.firstIsAudiobook).toBe(true);
    expect(result.firstAudiobook?.id).toBe('x');
    expect(result.next?.id).toBe('y');
  });

  test('prefers an audiobook among parts tied for part 1', () => {
    const result = pickSeriesParts([item('e1', false, 1), item('a1', true, 1)], 1);
    expect(result.first?.id).toBe('a1');
    expect(result.firstIsAudiobook).toBe(true);
  });

  test('empty series', () => {
    expect(pickSeriesParts([], 1)).toEqual({
      first: null,
      firstIsAudiobook: false,
      firstAudiobook: null,
      next: null,
      parts: [],
    });
  });
});

describe('createTtlCache', () => {
  test('hits before the ttl and misses at it', () => {
    let clock = 1000;
    const cache = createTtlCache<string>(3_600_000, () => clock);
    cache.set('k', 'v');
    clock += 3_599_999;
    expect(cache.get('k')).toBe('v');
    clock += 1;
    expect(cache.get('k')).toBeUndefined();
  });
});

describe('unreleased and locked audiobooks', () => {
  const withAbook = (extra: Record<string, unknown>) => ({
    ...rawItem('9', ['abook']),
    formats: [{ type: 'abook', cover: { url: 'https://c/9' }, ...extra }],
  });

  test('an unreleased abook is not playable', () => {
    expect(toDiscoveryItem(withAbook({ isReleased: false }))?.hasAbook).toBe(false);
  });

  test('a locked abook is not playable', () => {
    expect(toDiscoveryItem(withAbook({ isLockedContent: true }))?.hasAbook).toBe(false);
  });

  test('a released, unlocked abook is playable', () => {
    expect(toDiscoveryItem(withAbook({ isReleased: true, isLockedContent: false }))?.hasAbook).toBe(
      true,
    );
  });

  test('Czerwony plecak from the trending sample is dropped from lists', async () => {
    const sample = await Bun.file(
      new URL('../.superpowers/sdd/2026-10-22-discovery/fixtures/trending.json', import.meta.url),
    ).json();
    const find = (o: any): any => {
      if (!o || typeof o !== 'object') return undefined;
      if (typeof o.title === 'string' && o.title.includes('Czerwony plecak')) return o;
      for (const v of Object.values(o)) {
        const r = find(v);
        if (r) return r;
      }
      return undefined;
    };
    const mapped = toDiscoveryItem(find(sample));
    expect(mapped?.hasAbook).toBe(false);
    expect(playableOnly(mapped ? [mapped] : [])).toEqual([]);
  });
});
