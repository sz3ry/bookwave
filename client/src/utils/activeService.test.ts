import { describe, expect, test } from 'bun:test';
import { resolveActiveService, resolveAndPersistActive } from './activeService';

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

const storytelLegacy = { book: null, bookId: '123456', consumableId: 'aB3dE' };

const memoryStore = (initial: Record<string, string>) => {
  const data = { ...initial };
  return {
    data,
    get: async (key: string) => data[key],
    set: async (key: string, value: string) => {
      data[key] = value;
    },
    remove: async (key: string) => {
      delete data[key];
    },
  };
};

describe('resolveActiveService', () => {
  test('migrates a Storytel legacy record', () => {
    expect(
      resolveActiveService({
        stored: null,
        storytel: true,
        audioteka: true,
        legacySession: storytelLegacy,
      }),
    ).toBe('storytel');
  });

  test('ignores the legacy owner when it is logged out', () => {
    expect(
      resolveActiveService({
        stored: null,
        storytel: true,
        audioteka: false,
        legacySession: audiotekaLegacy,
      }),
    ).toBe('storytel');
  });

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

describe('resolveAndPersistActive', () => {
  const both = { storytel: true, audioteka: true };

  test('copies the legacy record only when the provider slot is empty', async () => {
    const store = memoryStore({ last_played_session: JSON.stringify(audiotekaLegacy) });
    await resolveAndPersistActive(store, both);
    expect(store.data['last_played_session:audioteka']).toBe(JSON.stringify(audiotekaLegacy));

    const newer = JSON.stringify({
      ...audiotekaLegacy,
      entry: { ...audiotekaLegacy.entry, title: 'N' },
    });
    const filled = memoryStore({
      last_played_session: JSON.stringify(audiotekaLegacy),
      'last_played_session:audioteka': newer,
    });
    await resolveAndPersistActive(filled, both);
    expect(filled.data['last_played_session:audioteka']).toBe(newer);
  });

  test('removes the legacy key after copying', async () => {
    const store = memoryStore({ last_played_session: JSON.stringify(storytelLegacy) });
    expect(await resolveAndPersistActive(store, both)).toBe('storytel');
    expect(store.data['last_played_session:storytel']).toBe(JSON.stringify(storytelLegacy));
    expect('last_played_session' in store.data).toBe(false);
  });

  test('persists the resolved service only when nothing is stored', async () => {
    const empty = memoryStore({});
    expect(await resolveAndPersistActive(empty, both)).toBe('storytel');
    expect(empty.data.activeService).toBe('"storytel"');
  });

  test('keeps the stored choice when its service is logged out', async () => {
    const store = memoryStore({ activeService: '"audioteka"' });
    const active = await resolveAndPersistActive(store, { storytel: true, audioteka: false });
    expect(active).toBe('storytel');
    expect(store.data.activeService).toBe('"audioteka"');
  });
});
