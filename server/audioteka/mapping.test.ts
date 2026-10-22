import { describe, expect, test } from 'bun:test';
import {
  embeddedItems,
  isListenable,
  mergeLibrary,
  toAudiotekaBook,
  toRemotePosition,
  toTimeline,
} from './mapping';

const product = (id: string, name: string, durationMs = 34589780) => ({
  id,
  name,
  image_url: `https://atkcdn.audioteka.com/cc/e4/${id}/4.jpg`,
  tracks_duration_in_ms: durationMs,
  authors: [{ id: 'a1', value: 'Andrzej Sapkowski' }],
  lectors: [
    { id: 'l1', value: 'Krzysztof Gosztyła' },
    { id: 'l2', value: 'Anna Dereszowska' },
  ],
});
const list = (...items: unknown[]) => ({
  count: items.length,
  _embedded: { 'app:product': items },
});

describe('mergeLibrary', () => {
  test('orders recent, favourites, shelf and de-duplicates', () => {
    const lib = mergeLibrary(
      {
        recent: list(product('r1', 'Rozdroże kruków'), product('x', 'Lalka')),
        favourites: list(product('x', 'Lalka'), product('f1', 'Janosik')),
        shelf: { total: 0 },
      },
      {
        _embedded: {
          'app:playback-progress': [{ position: 11582000, product_id: 'x', progress: 11 }],
        },
      },
    );
    expect(lib.map((b) => b.id)).toEqual(['r1', 'x', 'f1']);
    expect(lib[1].sources).toEqual(['recent', 'favourite']);
    expect(lib[1].positionMs).toBe(11582000);
    expect(lib[0].positionMs).toBeNull();
    expect(lib[0].available).toBe(true);
    expect(lib[0]).toMatchObject({
      authors: ['Andrzej Sapkowski'],
      narrators: ['Krzysztof Gosztyła', 'Anna Dereszowska'],
      durationMs: 34589780,
    });
  });

  test('tolerates garbage input', () => {
    expect(mergeLibrary({ recent: null, favourites: 'x', shelf: undefined }, null)).toEqual([]);
  });
});

describe('isListenable', () => {
  test('is false only when every stated channel is unlistenable', () => {
    expect(isListenable({ oneoff: { state: 'CAN_BUY' }, promotion: { state: 'CAN_LISTEN' } })).toBe(
      true,
    );
    expect(
      isListenable({
        oneoff: { state: 'CAN_BUY' },
        shared: { state: 'NOT_AVAILABLE' },
        subscription_banner: { visible: false },
      }),
    ).toBe(false);
    expect(isListenable({ oneoff: { state: 'SOMETHING_NEW' } })).toBe(true);
    expect(isListenable(null)).toBe(true);
  });
});

describe('toTimeline', () => {
  test('sorts by index and accumulates start offsets', () => {
    const tracks = {
      _embedded: {
        'app:track': [
          { id: 'b', index: 1, duration: 1741714 },
          { id: 'a', index: 0, duration: 1381303 },
          { id: 'c', index: 2, duration: 857365 },
        ],
      },
    };
    expect(toTimeline(tracks)).toEqual([
      { id: 'a', index: 0, durationMs: 1381303, startMs: 0 },
      { id: 'b', index: 1, durationMs: 1741714, startMs: 1381303 },
      { id: 'c', index: 2, durationMs: 857365, startMs: 3123017 },
    ]);
    expect(toTimeline({ count: 0 })).toEqual([]);
  });
});

describe('toRemotePosition', () => {
  test('reads position and device', () => {
    expect(toRemotePosition({ position: 5098, device: 'iPhone', product_id: 'r1' })).toEqual({
      positionMs: 5098,
      device: 'iPhone',
    });
    expect(toRemotePosition({})).toBeNull();
  });
});

describe('toAudiotekaBook', () => {
  test('reads a detail response', () => {
    expect(
      toAudiotekaBook({
        id: 'r1',
        name: 'Rozdroże kruków',
        image_url: null,
        tracks_duration_in_ms: 1,
        _embedded: {
          'app:author': [{ name: 'Andrzej Sapkowski' }],
          'app:lector': [{ name: 'Krzysztof Gosztyła' }],
        },
      }),
    ).toMatchObject({
      authors: ['Andrzej Sapkowski'],
      narrators: ['Krzysztof Gosztyła'],
      coverUrl: null,
    });
    expect(toAudiotekaBook({ name: 'no id' })).toBeNull();
  });
});

test('embeddedItems flattens _embedded values', () => {
  expect(embeddedItems({ _embedded: { a: [1, 2], b: [3] } })).toEqual([1, 2, 3]);
  expect(embeddedItems({ total: 0 })).toEqual([]);
});
