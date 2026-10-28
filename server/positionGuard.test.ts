import { describe, expect, test } from 'bun:test';
import { remoteMovedSince } from './positionGuard';

describe('remoteMovedSince', () => {
  test('an unguarded write is never skipped', () => {
    expect(remoteMovedSince(900_000, undefined)).toBe(false);
    expect(remoteMovedSince(900_000, 'x')).toBe(false);
  });

  test('no provider position is not a move', () => {
    expect(remoteMovedSince(null, 50_000)).toBe(false);
  });

  test('a position still at the last seen value is written', () => {
    expect(remoteMovedSince(50_000, 50_000)).toBe(false);
    expect(remoteMovedSince(50_600, 50_000)).toBe(false);
  });

  test('a position another device moved skips the write', () => {
    expect(remoteMovedSince(900_000, 50_000)).toBe(true);
  });
});
