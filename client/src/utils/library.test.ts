import { describe, expect, test } from 'bun:test';
import type { BookShelfEntity } from '../interfaces/books';
import type { AudiotekaLibraryEntry, LibraryBook } from '../interfaces/library';
import { fromAudiotekaEntry, fromShelfEntity, libraryFor } from './library';

const shelf = (o: {
  id?: number;
  abookId?: number;
  status?: number;
  pos?: number;
  time?: number;
  played?: string;
  state?: string;
  name?: string;
}) =>
  ({
    id: o.id ?? 1,
    status: o.status ?? 1,
    abook: { id: o.abookId ?? 100, time: o.time ?? 0 },
    abookMark: { pos: o.pos ?? 0 },
    book: { name: o.name ?? 'Book', authorsAsString: 'Author' },
    positionUpdatedTime: o.played,
    stateUpdateTime: o.state,
  }) as unknown as BookShelfEntity;

const entry = (o: Partial<AudiotekaLibraryEntry> = {}): AudiotekaLibraryEntry => ({
  id: 'a-1',
  title: 'Lalka',
  authors: ['Bolesław Prus'],
  narrators: ['Narrator'],
  coverUrl: null,
  durationMs: 100_000,
  sources: ['recent'],
  available: true,
  positionMs: null,
  ...o,
});

const book = (title: string, lastActivity: string | null) =>
  ({ provider: 'storytel', key: `storytel:${title}`, title, lastActivity }) as LibraryBook;

const ok = (books: LibraryBook[]): PromiseSettledResult<LibraryBook[]> => ({
  status: 'fulfilled',
  value: books,
});

describe('libraryFor', () => {
  test('libraryFor sorts by lastActivity desc, nulls last, then title', () => {
    const { books, failed } = libraryFor(
      ok([
        book('Zeta', null),
        book('Old', '2026-01-01T00:00:00Z'),
        book('Beta', '2026-05-01T00:00:00Z'),
        book('Alpha', null),
        book('New', '2026-09-01T00:00:00Z'),
        book('Alpha2', '2026-05-01T00:00:00Z'),
      ]),
    );
    expect(books.map((b) => b.title)).toEqual(['New', 'Alpha2', 'Beta', 'Old', 'Alpha', 'Zeta']);
    expect(failed).toBe(false);
  });

  test('libraryFor reports a rejected load as failed', () => {
    expect(libraryFor({ status: 'rejected', reason: new Error('down') })).toEqual({
      books: [],
      failed: true,
    });
  });
});

describe('fromAudiotekaEntry', () => {
  test('status thresholds: 0, 50% and 98% of the duration', () => {
    expect(fromAudiotekaEntry(entry({ positionMs: 0 }), null).status).toBe('notStarted');
    expect(fromAudiotekaEntry(entry({ positionMs: null }), null).status).toBe('notStarted');
    expect(fromAudiotekaEntry(entry({ positionMs: 50_000 }), null).status).toBe('started');
    expect(fromAudiotekaEntry(entry({ positionMs: 98_000 }), null).status).toBe('concluded');
  });

  test('a local position wins over the remote one', () => {
    const b = fromAudiotekaEntry(entry({ positionMs: 10_000 }), {
      position: 60_000,
      updatedAt: '2026-10-01T10:00:00.000Z',
    });
    expect(b.positionMs).toBe(60_000);
    expect(b.lastActivity).toBe('2026-10-01T10:00:00.000Z');
    expect(b.key).toBe('audioteka:a-1');
    expect(b.authors).toBe('Bolesław Prus');
  });

  test('without a local position lastActivity is null', () => {
    expect(fromAudiotekaEntry(entry({ positionMs: 5098 }), null)).toMatchObject({
      positionMs: 5098,
      lastActivity: null,
    });
  });
});

describe('fromShelfEntity', () => {
  test('statuses match the Dashboard logic for status values 1, 2 and 3', () => {
    expect(fromShelfEntity(shelf({ status: 1, pos: 0 })).status).toBe('notStarted');
    expect(fromShelfEntity(shelf({ status: 1, pos: 5 })).status).toBe('started');
    expect(fromShelfEntity(shelf({ status: 2, pos: 0 })).status).toBe('started');
    expect(fromShelfEntity(shelf({ status: 3, pos: 0 })).status).toBe('concluded');
    expect(fromShelfEntity(shelf({ status: 3, pos: 5 })).status).toBe('concluded');
  });

  test('maps key, units and lastActivity like compareByRecency', () => {
    const b = fromShelfEntity(
      shelf({
        id: 7,
        abookId: 42,
        pos: 3_000_000,
        time: 9_000_000,
        played: '2026-02-01T00:00:00Z',
        state: '2026-01-01T00:00:00Z',
      }),
    );
    expect(b).toMatchObject({
      provider: 'storytel',
      key: 'storytel:42',
      positionMs: 3000,
      durationMs: 9000,
      lastActivity: '2026-02-01T00:00:00Z',
    });
    expect(fromShelfEntity(shelf({ state: '2026-01-01T00:00:00Z' })).lastActivity).toBe(
      '2026-01-01T00:00:00Z',
    );
    expect(fromShelfEntity(shelf({})).lastActivity).toBeNull();
  });
});
