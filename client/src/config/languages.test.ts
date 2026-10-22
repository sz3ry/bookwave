import { describe, expect, test } from 'bun:test';
import { APP_LANGUAGES, findLanguage, negotiateLanguage } from './languages';

describe('negotiateLanguage (renderer)', () => {
  test('a Polish system locale resolves to Polish', () => {
    expect(negotiateLanguage(['pl-PL', 'en-US'])).toBe('pl');
    expect(negotiateLanguage(['pl_PL'])).toBe('pl');
  });

  test('the region never decides the language', () => {
    expect(negotiateLanguage(['en-PL'])).toBe('en');
  });
});

describe('APP_LANGUAGES', () => {
  test('Polish is listed by its endonym, between Italiano and Suomi', () => {
    expect(findLanguage('pl')?.nativeName).toBe('Polski');

    const codes = APP_LANGUAGES.map((language) => language.code);
    const pl = codes.indexOf('pl');
    expect(codes[pl - 1]).toBe('it');
    expect(codes[pl + 1]).toBe('fi');
  });
});
