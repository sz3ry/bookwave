import { describe, expect, test } from 'bun:test';
import { isAudiotekaSession, isStorytelSession } from './lastSession';

const AUDIOTEKA_ID = '0f8c5a52-1111-4222-8333-944445555666';

const audiotekaEntry = {
  id: AUDIOTEKA_ID,
  title: 'Pan Tadeusz',
  authors: ['Adam Mickiewicz'],
  narrators: ['Jan Kowalski'],
  coverUrl: 'https://example.invalid/cover.jpg',
  durationMs: 3_600_000,
  sources: ['recent'],
  available: true,
  positionMs: 120_000,
};

describe('isStorytelSession', () => {
  test('accepts a Storytel book id with or without a consumable id', () => {
    expect(isStorytelSession({ book: null, bookId: '123456', consumableId: 'aB3dE' })).toBe(true);
    expect(isStorytelSession({ bookId: '123456' })).toBe(true);
    expect(isStorytelSession({ bookId: 123456 })).toBe(true);
  });

  test('rejects an Audioteka book id', () => {
    const id = AUDIOTEKA_ID;
    expect(isStorytelSession({ book: null, bookId: id, consumableId: id })).toBe(false);
    expect(isStorytelSession({ bookId: '123456', consumableId: id })).toBe(false);
  });

  test('rejects another provider and malformed entries', () => {
    expect(isStorytelSession({ provider: 'audioteka', bookId: '123456' })).toBe(false);
    expect(isStorytelSession({ provider: 'audioteka', entry: audiotekaEntry })).toBe(false);
    expect(isStorytelSession({ bookId: '' })).toBe(false);
    expect(isStorytelSession({})).toBe(false);
    expect(isStorytelSession(null)).toBe(false);
    expect(isStorytelSession('123456')).toBe(false);
  });
});

describe('isAudiotekaSession', () => {
  test('accepts an Audioteka library entry', () => {
    expect(isAudiotekaSession({ provider: 'audioteka', entry: audiotekaEntry })).toBe(true);
    expect(
      isAudiotekaSession({
        provider: 'audioteka',
        entry: { ...audiotekaEntry, coverUrl: null, positionMs: null, sources: [] },
      }),
    ).toBe(true);
  });

  test('rejects a Storytel session, legacy or tagged', () => {
    expect(isAudiotekaSession({ book: null, bookId: '123456', consumableId: 'aB3dE' })).toBe(false);
    expect(isAudiotekaSession({ provider: 'storytel', bookId: '123456' })).toBe(false);
  });

  test('rejects an Audioteka id in a Storytel-shaped record (earlier builds)', () => {
    const legacy = { book: null, bookId: AUDIOTEKA_ID, consumableId: AUDIOTEKA_ID };
    expect(isAudiotekaSession(legacy)).toBe(false);
    expect(isStorytelSession(legacy)).toBe(false);
  });

  test('rejects malformed entries', () => {
    const withEntry = (patch: Record<string, unknown>) => ({
      provider: 'audioteka',
      entry: { ...audiotekaEntry, ...patch },
    });
    expect(isAudiotekaSession(withEntry({ id: '123456' }))).toBe(false);
    expect(isAudiotekaSession(withEntry({ title: 42 }))).toBe(false);
    expect(isAudiotekaSession(withEntry({ authors: 'Adam Mickiewicz' }))).toBe(false);
    expect(isAudiotekaSession(withEntry({ narrators: [1] }))).toBe(false);
    expect(isAudiotekaSession(withEntry({ coverUrl: 7 }))).toBe(false);
    expect(isAudiotekaSession(withEntry({ durationMs: -1 }))).toBe(false);
    expect(isAudiotekaSession(withEntry({ durationMs: Number.NaN }))).toBe(false);
    expect(isAudiotekaSession(withEntry({ available: 'yes' }))).toBe(false);
    expect(isAudiotekaSession(withEntry({ positionMs: '5' }))).toBe(false);
    expect(isAudiotekaSession(withEntry({ sources: ['elsewhere'] }))).toBe(false);
    expect(isAudiotekaSession({ provider: 'audioteka' })).toBe(false);
    expect(isAudiotekaSession({ provider: 'audioteka', entry: null })).toBe(false);
    expect(isAudiotekaSession({ entry: audiotekaEntry })).toBe(false);
    expect(isAudiotekaSession(null)).toBe(false);
    expect(isAudiotekaSession('audioteka')).toBe(false);
  });
});
