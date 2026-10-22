import { describe, expect, test } from 'bun:test';
import type { TimelineTrack } from './timeline';
import {
  bookPositionMs,
  bookSeconds,
  nextTrackIndex,
  nextUrlRetry,
  planSeek,
} from './trackNavigation';

// Storytel: one track whose duration is unknown until the metadata loads.
const single: TimelineTrack[] = [{ id: 'c-1', startMs: 0, durationMs: 0 }];
const three: TimelineTrack[] = [
  { id: 'a', startMs: 0, durationMs: 60_000 },
  { id: 'b', startMs: 60_000, durationMs: 60_000 },
  { id: 'c', startMs: 120_000, durationMs: 30_000 },
];

describe('bookSeconds', () => {
  test('a single track is the element time, whatever its duration says', () => {
    expect(bookSeconds(single, 0, 4321.5)).toBe(4321.5);
  });

  test('a later track adds its start', () => {
    expect(bookSeconds(three, 1, 10)).toBe(70);
    expect(bookSeconds(three, 2, 0)).toBe(120);
  });
});

describe('planSeek', () => {
  test('a single track never clamps through the timeline (R3)', () => {
    expect(planSeek(single, 0, 5000)).toEqual({ kind: 'element', seconds: 5000 });
  });

  test('a position on the loaded track only moves the element', () => {
    expect(planSeek(three, 1, 75)).toEqual({ kind: 'element', seconds: 15 });
  });

  test('a position on another track switches tracks', () => {
    expect(planSeek(three, 0, 130)).toEqual({ kind: 'track', index: 2, offsetSeconds: 10 });
  });

  test('a boundary belongs to the next track', () => {
    expect(planSeek(three, 0, 60)).toEqual({ kind: 'track', index: 1, offsetSeconds: 0 });
  });

  test('without a loaded track (index -1) every target loads one', () => {
    expect(planSeek(three, -1, 75)).toEqual({ kind: 'track', index: 1, offsetSeconds: 15 });
  });

  test('positions outside the book clamp', () => {
    expect(planSeek(three, 2, -5)).toEqual({ kind: 'track', index: 0, offsetSeconds: 0 });
    expect(planSeek(three, 2, 999)).toEqual({ kind: 'element', seconds: 30 });
  });
});

describe('nextTrackIndex', () => {
  test('continues with the next track and stops after the last', () => {
    expect(nextTrackIndex(three, 0)).toBe(1);
    expect(nextTrackIndex(three, 2)).toBeNull();
    expect(nextTrackIndex(single, 0)).toBeNull();
  });
});

describe('nextUrlRetry', () => {
  const none = { index: -1, at: [] };

  test('allows two re-resolves of a track within 10 s, then gives up', () => {
    expect(nextUrlRetry(none, 3, 1000)).toEqual({ index: 3, at: [1000] });
    expect(nextUrlRetry({ index: 3, at: [1000] }, 3, 4000)).toEqual({
      index: 3,
      at: [1000, 4000],
    });
    expect(nextUrlRetry({ index: 3, at: [1000, 4000] }, 3, 9000)).toBeNull();
  });

  test('forgets attempts older than the window', () => {
    const history = { index: 3, at: [1000, 4000] };
    expect(nextUrlRetry(history, 3, 11_000)).toEqual({ index: 3, at: [4000, 11_000] });
  });

  test('counts each track on its own', () => {
    expect(nextUrlRetry({ index: 3, at: [1000, 4000] }, 4, 5000)).toEqual({
      index: 4,
      at: [5000],
    });
  });
});

describe('bookPositionMs', () => {
  const tracks: TimelineTrack[] = [
    { id: 'a', startMs: 0, durationMs: 120_000 },
    { id: 'b', startMs: 120_000, durationMs: 80_000 },
  ];

  test('uses the element time on the loaded track', () => {
    expect(bookPositionMs(tracks, 1, 30.5, null)).toBe(150_500);
  });

  test('uses the pending target while a switch is pending', () => {
    // The element already holds track b but reads 0 before its metadata
    expect(bookPositionMs(tracks, 1, 0, { index: 1, offsetSeconds: 42 })).toBe(162_000);
    // The element still holds track a while b's URL resolves
    expect(bookPositionMs(tracks, 0, 119, { index: 1, offsetSeconds: 0 })).toBe(120_000);
  });

  test('a single-track book is the element time', () => {
    const single = [{ id: 's', startMs: 0, durationMs: 0 }];
    expect(bookPositionMs(single, 0, 75.9, null)).toBe(75_900);
  });
});
