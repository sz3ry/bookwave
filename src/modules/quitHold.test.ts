import { describe, expect, test } from 'bun:test';
import { createQuitHold } from './quitHold';

describe('createQuitHold', () => {
  test('holds a normal quit once', async () => {
    let settles = 0;
    const hold = createQuitHold(async () => {
      settles += 1;
    });
    const wait = hold.begin();
    expect(wait).not.toBeNull();
    await wait;
    // The quit that follows the hold goes ahead
    expect(hold.begin()).toBeNull();
    expect(settles).toBe(1);
  });

  test('never holds a quit for an update', () => {
    let settles = 0;
    const hold = createQuitHold(async () => {
      settles += 1;
    });
    hold.markQuittingForUpdate();
    expect(hold.begin()).toBeNull();
    expect(settles).toBe(0);
  });
});
