import { describe, expect, test } from 'bun:test';
import type { BookShelfEntity, SeriesInfo } from '../interfaces/books';
import type { LibraryBook } from '../interfaces/library';
import {
  audiotekaCandidates,
  candidateBookId,
  pickFinishedSeries,
  type SeriesCandidate,
  shelfCandidate,
} from './series';

const candidate = (
  key: string,
  o: { series?: string; finished?: boolean; at?: string | null; order?: number | null } = {},
): SeriesCandidate => ({
  key,
  seriesId: o.series ?? '',
  orderInSeries: o.order === undefined ? 1 : o.order,
  finished: o.finished ?? true,
  timestamp: o.at ?? null,
});

const keys = (items: SeriesCandidate[]) => pickFinishedSeries(items).map((c) => c.key);

describe('pickFinishedSeries', () => {
  test('excludes finished books without a series', () => {
    expect(keys([candidate('storytel:1')])).toEqual([]);
  });

  test('excludes unfinished books', () => {
    expect(keys([candidate('storytel:1', { series: 's', finished: false })])).toEqual([]);
  });

  test('keeps only the newest finished book of a series', () => {
    const items = [
      candidate('storytel:1', { series: 's', at: '2026-01-01T00:00:00Z' }),
      candidate('storytel:2', { series: 's', at: '2026-02-01T00:00:00Z' }),
    ];
    expect(keys(items)).toEqual(['storytel:2']);
  });

  test('orders newest first, books without a timestamp last', () => {
    const items = [
      candidate('storytel:1', { series: 'a', at: '2026-01-01T00:00:00Z' }),
      candidate('storytel:2', { series: 'b', at: null }),
      candidate('storytel:3', { series: 'c', at: '2026-03-01T00:00:00Z' }),
      candidate('storytel:4', { series: 'd', at: '2026-02-01T00:00:00Z' }),
    ];
    expect(keys(items)).toEqual(['storytel:3', 'storytel:4', 'storytel:1', 'storytel:2']);
  });

  test('caps at 10 series', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      candidate(`storytel:${i}`, { series: `s${i}`, at: new Date(2026, 0, i + 1).toISOString() }),
    );
    expect(pickFinishedSeries(items)).toHaveLength(10);
  });

  test('works for Audioteka keys', () => {
    const uuid = '0b9f6c3e-1d2a-4c5b-8e7f-123456789abc';
    const picked = pickFinishedSeries([
      candidate(`audioteka:${uuid}`, { series: 'cycle-1', order: null }),
    ]);
    expect(picked.map((c) => c.key)).toEqual([`audioteka:${uuid}`]);
    expect(candidateBookId(picked[0])).toBe(uuid);
  });
});

const entity = (
  consumableId: string,
  o: {
    series?: string;
    status?: number;
    pos?: number;
    time?: number;
    played?: string;
    state?: string;
  } = {},
) =>
  ({
    id: 1,
    status: o.status ?? 3,
    abook: { id: 9, time: o.time ?? 0 },
    abookMark: { pos: o.pos ?? 0 },
    book: {
      consumableId,
      seriesInfo: o.series ? { id: o.series, name: o.series, orderInSeries: 2 } : undefined,
    },
    positionUpdatedTime: o.played,
    stateUpdateTime: o.state,
  }) as unknown as BookShelfEntity;

describe('shelfCandidate', () => {
  test('returns null without a series', () => {
    expect(shelfCandidate(entity('c1'))).toBeNull();
  });

  test('keys by consumable id and ranks by positionUpdatedTime, then stateUpdateTime', () => {
    expect(
      shelfCandidate(
        entity('c1', { series: 's', played: '2026-02-01T00:00:00Z', state: '2026-01-01' }),
      ),
    ).toEqual({
      key: 'storytel:c1',
      seriesId: 's',
      orderInSeries: 2,
      finished: true,
      timestamp: '2026-02-01T00:00:00Z',
    });
    expect(shelfCandidate(entity('c1', { series: 's', state: '2026-01-01' }))?.timestamp).toBe(
      '2026-01-01',
    );
  });

  test('counts status 3 and position >= 98% as finished', () => {
    const finished = (o: { status: number; pos?: number; time?: number }) =>
      shelfCandidate(entity('c', { series: 's', ...o }))?.finished;
    expect(finished({ status: 3 })).toBe(true);
    expect(finished({ status: 2, pos: 980, time: 1000 })).toBe(true);
    expect(finished({ status: 2, pos: 979, time: 1000 })).toBe(false);
  });
});

const libraryBook = (
  id: string,
  status: LibraryBook['status'],
  lastActivity: string | null,
): LibraryBook => ({
  provider: 'audioteka',
  key: `audioteka:${id}`,
  title: id,
  authors: '',
  coverUrl: null,
  durationMs: 1000,
  positionMs: 0,
  status,
  lastActivity,
  available: true,
});

describe('audiotekaCandidates', () => {
  test('looks up the 10 most recent concluded books and skips failures', async () => {
    const books = [
      libraryBook('started', 'started', '2026-05-01T00:00:00Z'),
      ...Array.from({ length: 12 }, (_, i) =>
        libraryBook(`b${i}`, 'concluded', new Date(2026, 0, i + 1).toISOString()),
      ),
    ];
    const asked: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const seriesInfo = async (id: string): Promise<SeriesInfo | null> => {
      asked.push(id);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      if (id === 'b11') throw new Error('boom');
      if (id === 'b10') return null;
      return { id: `cycle-${id}`, name: id, orderInSeries: null };
    };

    const result = await audiotekaCandidates(books, seriesInfo, 3);

    expect(asked.sort()).toEqual(['b10', 'b11', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']);
    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(result.map((c) => c.key)).toEqual(
      ['b9', 'b8', 'b7', 'b6', 'b5', 'b4', 'b3', 'b2'].map((id) => `audioteka:${id}`),
    );
    expect(result[0]).toEqual({
      key: 'audioteka:b9',
      seriesId: 'cycle-b9',
      orderInSeries: null,
      finished: true,
      timestamp: new Date(2026, 0, 10).toISOString(),
    });
  });
});
