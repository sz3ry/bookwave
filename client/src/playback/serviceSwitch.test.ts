import { describe, expect, test } from 'bun:test';
import { planServiceSwitch } from './serviceSwitch';

describe('planServiceSwitch', () => {
  test('switch saves the position before restoring the other service', () => {
    expect(
      planServiceSwitch({ from: 'storytel', to: 'audioteka', playing: true, hasActiveBook: true }),
    ).toEqual(['pause', 'savePosition', 'clearActiveBook', 'restoreLastSession']);
  });

  test('switch with a paused book saves it without pausing', () => {
    expect(
      planServiceSwitch({ from: 'audioteka', to: 'storytel', playing: false, hasActiveBook: true }),
    ).toEqual(['savePosition', 'clearActiveBook', 'restoreLastSession']);
  });

  test('switch without an active book only restores', () => {
    expect(
      planServiceSwitch({
        from: 'storytel',
        to: 'audioteka',
        playing: false,
        hasActiveBook: false,
      }),
    ).toEqual(['restoreLastSession']);
  });

  test('same service is a no-op', () => {
    expect(
      planServiceSwitch({ from: 'storytel', to: 'storytel', playing: true, hasActiveBook: true }),
    ).toEqual([]);
  });

  test('the first service at mount only restores', () => {
    expect(
      planServiceSwitch({ from: null, to: 'audioteka', playing: false, hasActiveBook: false }),
    ).toEqual(['restoreLastSession']);
  });
});
