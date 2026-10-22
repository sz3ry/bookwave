import { describe, expect, test } from 'bun:test';
import { isStorytelSession } from './lastSession';

describe('isStorytelSession', () => {
  test('accepts a Storytel book id with or without a consumable id', () => {
    expect(isStorytelSession({ book: null, bookId: '123456', consumableId: 'aB3dE' })).toBe(true);
    expect(isStorytelSession({ bookId: '123456' })).toBe(true);
    expect(isStorytelSession({ bookId: 123456 })).toBe(true);
  });

  test('rejects an Audioteka book id', () => {
    const id = '0f8c5a52-1111-4222-8333-944445555666';
    expect(isStorytelSession({ book: null, bookId: id, consumableId: id })).toBe(false);
    expect(isStorytelSession({ bookId: '123456', consumableId: id })).toBe(false);
  });

  test('rejects another provider and malformed entries', () => {
    expect(isStorytelSession({ provider: 'audioteka', bookId: '123456' })).toBe(false);
    expect(isStorytelSession({ bookId: '' })).toBe(false);
    expect(isStorytelSession({})).toBe(false);
    expect(isStorytelSession(null)).toBe(false);
    expect(isStorytelSession('123456')).toBe(false);
  });
});
