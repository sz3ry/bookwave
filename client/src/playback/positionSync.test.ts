import { describe, expect, test } from 'bun:test';
import {
  resolveStartPosition,
  type StoredPosition,
  shouldRecheckRemote,
  shouldWriteRemote,
  storedPosition,
  withRemoteSeen,
} from './positionSync';

const local = (position: number, remoteSeen?: number): StoredPosition => ({
  position,
  updatedAt: '2026-10-22T10:00:00.000Z',
  ...(remoteSeen === undefined ? {} : { remoteSeen }),
});
const remote = (positionMs: number) => ({ positionMs, device: 'Phone' });

describe('resolveStartPosition', () => {
  test('no local uses remote', () => {
    expect(resolveStartPosition(null, remote(5000))).toEqual({
      kind: 'use',
      positionMs: 5000,
      source: 'remote',
    });
  });
  test('no local and no remote starts at 0', () => {
    expect(resolveStartPosition(null, null)).toEqual({
      kind: 'use',
      positionMs: 0,
      source: 'remote',
    });
  });
  test('no remote uses local', () => {
    expect(resolveStartPosition(local(7000), null)).toEqual({
      kind: 'use',
      positionMs: 7000,
      source: 'local',
    });
  });
  test('remote unchanged since last seen uses local, however far apart', () => {
    const twoHours = 2 * 3_600_000;
    expect(resolveStartPosition(local(twoHours + 1000, 1000), remote(1000))).toEqual({
      kind: 'use',
      positionMs: twoHours + 1000,
      source: 'local',
    });
  });
  test('difference within the threshold uses local', () => {
    expect(resolveStartPosition(local(100_000), remote(130_000))).toEqual({
      kind: 'use',
      positionMs: 100_000,
      source: 'local',
    });
  });
  test('difference over the threshold asks', () => {
    expect(resolveStartPosition(local(100_000), remote(131_000))).toEqual({
      kind: 'ask',
      localMs: 100_000,
      remoteMs: 131_000,
      device: 'Phone',
    });
  });
  test('remote moved by another device since last seen asks', () => {
    expect(resolveStartPosition(local(100_000, 50_000), remote(900_000))).toMatchObject({
      kind: 'ask',
    });
  });
  test('custom threshold', () => {
    expect(resolveStartPosition(local(0), remote(5000), 'ask', 1000)).toMatchObject({
      kind: 'ask',
    });
  });
  test('follow takes a remote another device moved, without asking', () => {
    expect(resolveStartPosition(local(100_000, 50_000), remote(900_000), 'follow')).toEqual({
      kind: 'use',
      positionMs: 900_000,
      source: 'remote',
    });
  });
  describe('follow without remoteSeen', () => {
    // `local()` is stored at 2026-10-22T10:00
    const at = (positionMs: number, updatedTime?: string) => ({
      positionMs,
      device: null,
      updatedTime,
    });

    // Listened offline in an older build: the remote is older, keep local
    test('an older remote keeps local', () => {
      expect(
        resolveStartPosition(local(900_000), at(50_000, '2026-10-22T08:00:00.000Z'), 'follow')
          .source,
      ).toBe('local');
      expect(resolveStartPosition(local(900_000), at(50_000), 'follow').source).toBe('local');
    });

    test('a newer remote is followed', () => {
      expect(
        resolveStartPosition(local(50_000), at(900_000, '2026-10-22T12:00:00.000Z'), 'follow'),
      ).toEqual({ kind: 'use', positionMs: 900_000, source: 'remote' });
    });
  });

  test('follow keeps local when the remote is unchanged or close', () => {
    // Listened offline: the remote still holds what Bookwave last saw
    expect(resolveStartPosition(local(900_000, 50_000), remote(50_000), 'follow')).toEqual({
      kind: 'use',
      positionMs: 900_000,
      source: 'local',
    });
    expect(resolveStartPosition(local(100_000), remote(130_000), 'follow').source).toBe('local');
  });
});

describe('storedPosition', () => {
  const at = new Date('2026-10-23T10:00:00.000Z');

  test('keeps remoteSeen only when known', () => {
    expect(storedPosition(5000, undefined, at)).toEqual({
      position: 5000,
      updatedAt: '2026-10-23T10:00:00.000Z',
    });
    expect(storedPosition(5000, 3000, at)).toEqual({
      position: 5000,
      updatedAt: '2026-10-23T10:00:00.000Z',
      remoteSeen: 3000,
    });
  });

  // Last 60 s remote write at 3:00, then quit at 3:55: the quit's local write
  // keeps remoteSeen, so reopening does not ask whether or not the quit's
  // remote write made it.
  test('quit after a remote write does not ask on the next open', () => {
    const afterTick = storedPosition(180_000, 180_000, at);
    const onQuit = storedPosition(235_000, afterTick.remoteSeen, at);

    const remoteFlushFailed = { positionMs: 180_000, device: 'Bookwave' };
    expect(resolveStartPosition(onQuit, remoteFlushFailed)).toEqual({
      kind: 'use',
      positionMs: 235_000,
      source: 'local',
    });
    const remoteFlushDone = { positionMs: 235_000, device: 'Bookwave' };
    expect(resolveStartPosition(onQuit, remoteFlushDone)).toEqual({
      kind: 'use',
      positionMs: 235_000,
      source: 'local',
    });
    // Without remoteSeen the same quit would ask about Bookwave's own write
    expect(
      resolveStartPosition(storedPosition(235_000, undefined, at), remoteFlushFailed).kind,
    ).toBe('ask');
  });
});

describe('withRemoteSeen', () => {
  const at = new Date('2026-10-23T10:00:00.000Z');
  const later = new Date('2026-10-23T10:00:20.000Z');

  // The 60 s remote write of 180 s took longer than a 15 s tick, which saved
  // 195 s meanwhile: recording the write must not roll the position back.
  test('keeps a newer local position written while the remote write ran', () => {
    const tickDuringWrite = storedPosition(195_000, 120_000, at);
    expect(withRemoteSeen(tickDuringWrite, 180_000, later)).toEqual({
      position: 195_000,
      updatedAt: '2026-10-23T10:00:00.000Z',
      remoteSeen: 180_000,
    });
  });

  test('falls back to the written position when nothing is stored', () => {
    expect(withRemoteSeen(null, 180_000, later)).toEqual({
      position: 180_000,
      updatedAt: '2026-10-23T10:00:20.000Z',
      remoteSeen: 180_000,
    });
  });
});

describe('resume re-check', () => {
  const base = {
    switching: false,
    awaitingStart: false,
    lastCheckAt: null,
    now: 100_000,
  };

  test('re-checks a book that was never or not recently checked', () => {
    expect(shouldRecheckRemote(base)).toBe(true);
    expect(shouldRecheckRemote({ ...base, lastCheckAt: 90_000 })).toBe(true);
    expect(shouldRecheckRemote({ ...base, lastCheckAt: 95_000 })).toBe(false);
  });

  test('never re-checks during a track switch or while a book is loading', () => {
    expect(shouldRecheckRemote({ ...base, switching: true })).toBe(false);
    expect(shouldRecheckRemote({ ...base, awaitingStart: true })).toBe(false);
  });

  // The owner's case: paused at 23:19 with that value written remotely, then
  // the phone moved the book to 26:38. Resuming must ask, not play on.
  test('a paused book whose position the phone moved asks on resume', () => {
    const current = storedPosition(1_399_654, 1_399_654);
    expect(resolveStartPosition(current, { positionMs: 1_598_840, device: 'iPhone' })).toEqual({
      kind: 'ask',
      localMs: 1_399_654,
      remoteMs: 1_598_840,
      device: 'iPhone',
    });
    // Unchanged on the phone: play on
    expect(resolveStartPosition(current, { positionMs: 1_399_654, device: 'Bookwave' }).kind).toBe(
      'use',
    );
  });

  // Paused in Bookwave, listened on the Storytel phone app, back at the
  // computer: resuming jumps to the phone's position.
  test('a paused Storytel book the phone moved jumps on resume', () => {
    const current = storedPosition(1_399_654, 1_399_654);
    expect(
      resolveStartPosition(current, { positionMs: 3_200_000, device: null }, 'follow'),
    ).toEqual({ kind: 'use', positionMs: 3_200_000, source: 'remote' });
  });
});

describe('shouldWriteRemote', () => {
  test('a paused, untouched book never pushes its position', () => {
    expect(shouldWriteRemote(1_399_654, 1_399_654)).toBe(false);
    // Float rounding of the element time stays within the tolerance
    expect(shouldWriteRemote(1_400_400, 1_399_654)).toBe(false);
  });

  test('a book Bookwave moved is sent', () => {
    expect(shouldWriteRemote(1_460_000, 1_399_654)).toBe(true);
    expect(shouldWriteRemote(1_300_000, 1_399_654)).toBe(true);
  });

  test('without a known remote value the position is sent', () => {
    expect(shouldWriteRemote(5000, undefined)).toBe(true);
  });
});
