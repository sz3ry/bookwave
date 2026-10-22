import { describe, expect, test } from 'bun:test';
import type { TimelineTrack } from './timeline';
import { bookSeconds, nextTrackIndex, planSeek } from './trackNavigation';

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
