import { describe, expect, test } from 'bun:test';
import { negotiateLanguage } from './languages';

describe('negotiateLanguage (main process)', () => {
  test('a Polish system locale resolves to Polish', () => {
    expect(negotiateLanguage(['pl-PL', 'en-US'])).toBe('pl');
    expect(negotiateLanguage(['pl_PL'])).toBe('pl');
  });

  test('the region never decides the language', () => {
    expect(negotiateLanguage(['en-PL'])).toBe('en');
  });
});
