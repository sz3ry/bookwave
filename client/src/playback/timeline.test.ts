import { describe, expect, test } from 'bun:test';
import { createTrackUrlCache, locate, type TimelineTrack, totalDurationMs } from './timeline';

const tracks: TimelineTrack[] = [
  { id: 'a', startMs: 0, durationMs: 1381303 },
  { id: 'b', startMs: 1381303, durationMs: 1741714 },
  { id: 'c', startMs: 3123017, durationMs: 857365 },
];

describe('locate', () => {
  test('start of the book', () => {
    expect(locate(tracks, 0)).toEqual({ index: 0, offsetMs: 0 });
  });
  test('boundary belongs to the next track', () => {
    expect(locate(tracks, 1381303)).toEqual({ index: 1, offsetMs: 0 });
  });
  test('one ms before a boundary stays in the previous track', () => {
    expect(locate(tracks, 1381302)).toEqual({ index: 0, offsetMs: 1381302 });
  });
  test('clamps below zero', () => {
    expect(locate(tracks, -5)).toEqual({ index: 0, offsetMs: 0 });
  });
  test('clamps beyond the end to the last track end', () => {
    expect(locate(tracks, 10 ** 9)).toEqual({ index: 2, offsetMs: 857365 });
  });
  test('throws on an empty timeline', () => {
    expect(() => locate([], 100)).toThrow(/no tracks/i);
  });
});

describe('totalDurationMs', () => {
  test('sums to the end of the last track', () => {
    expect(totalDurationMs(tracks)).toBe(3980382);
    expect(totalDurationMs([])).toBe(0);
  });
});

describe('createTrackUrlCache', () => {
  test('hits until 5 minutes before expiry', () => {
    let now = 0;
    const cache = createTrackUrlCache(() => now);
    cache.set('a', 'https://cdn/a', 3_600_000);
    now = 3_299_999;
    expect(cache.get('a')).toBe('https://cdn/a');
    now = 3_300_000;
    expect(cache.get('a')).toBeUndefined();
  });
  test('invalidate drops the entry', () => {
    const cache = createTrackUrlCache(() => 0);
    cache.set('a', 'u', 3_600_000);
    cache.invalidate('a');
    expect(cache.get('a')).toBeUndefined();
  });
  test('unknown track is a miss', () => {
    expect(createTrackUrlCache(() => 0).get('x')).toBeUndefined();
  });
});
