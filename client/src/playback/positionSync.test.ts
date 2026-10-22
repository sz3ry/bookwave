import { describe, expect, test } from 'bun:test';
import { resolveStartPosition, type StoredPosition } from './positionSync';

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
    expect(resolveStartPosition(local(0), remote(5000), 1000)).toMatchObject({ kind: 'ask' });
  });
});
