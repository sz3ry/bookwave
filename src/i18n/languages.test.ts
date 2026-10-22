import { describe, expect, test } from 'bun:test';
import { negotiateLanguage, resolveUiLanguage } from './languages';

describe('negotiateLanguage (main process)', () => {
  test('a Polish system locale resolves to Polish', () => {
    expect(negotiateLanguage(['pl-PL', 'en-US'])).toBe('pl');
    expect(negotiateLanguage(['pl_PL'])).toBe('pl');
  });

  test('the region never decides the language', () => {
    expect(negotiateLanguage(['en-PL'])).toBe('en');
  });
});

describe('resolveUiLanguage (main process)', () => {
  test('follows the OS languages, whatever an older version stored', () => {
    // A stored `appLanguage` ('pl', ...) is not an input any more.
    expect(resolveUiLanguage(['de-AT', 'en-US'])).toBe('de');
  });

  test('falls back to APP_LOCALE and then English', () => {
    expect(resolveUiLanguage(['nl-NL'], 'sv')).toBe('sv');
    expect(resolveUiLanguage([])).toBe('en');
  });
});
