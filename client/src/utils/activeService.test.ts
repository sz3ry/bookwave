import { describe, expect, test } from 'bun:test';
import { resolveActiveService } from './activeService';

const AUDIOTEKA_ID = '0f8c5a52-1111-4222-8333-944445555666';
const audiotekaLegacy = {
  provider: 'audioteka',
  entry: {
    id: AUDIOTEKA_ID,
    title: 'Pan Tadeusz',
    authors: [],
    narrators: [],
    coverUrl: null,
    durationMs: 1000,
    sources: [],
    available: true,
    positionMs: null,
  },
};

describe('resolveActiveService', () => {
  test('keeps the stored service when logged in', () => {
    expect(
      resolveActiveService({
        stored: 'audioteka',
        storytel: true,
        audioteka: true,
        legacySession: null,
      }),
    ).toBe('audioteka');
  });

  test('falls back when the stored service is logged out', () => {
    expect(
      resolveActiveService({
        stored: 'audioteka',
        storytel: true,
        audioteka: false,
        legacySession: null,
      }),
    ).toBe('storytel');
  });

  test('migrates the legacy record to its provider', () => {
    expect(
      resolveActiveService({
        stored: null,
        storytel: true,
        audioteka: true,
        legacySession: audiotekaLegacy,
      }),
    ).toBe('audioteka');
  });

  test('prefers Storytel when both are logged in and nothing is known', () => {
    expect(
      resolveActiveService({ stored: null, storytel: true, audioteka: true, legacySession: null }),
    ).toBe('storytel');
  });

  test('returns null when nobody is logged in', () => {
    expect(
      resolveActiveService({
        stored: 'storytel',
        storytel: false,
        audioteka: false,
        legacySession: audiotekaLegacy,
      }),
    ).toBeNull();
  });
});
