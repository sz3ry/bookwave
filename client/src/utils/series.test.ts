import { describe, expect, test } from 'bun:test';
import type { BookShelfEntity } from '../interfaces/books';
import { pickFinishedSeries } from './series';

const make = (
  id: number,
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
    id,
    status: o.status ?? 3,
    abook: { time: o.time ?? 0 },
    abookMark: { pos: o.pos ?? 0 },
    book: { seriesInfo: o.series ? { id: o.series, name: o.series, orderInSeries: 1 } : undefined },
    positionUpdatedTime: o.played,
    stateUpdateTime: o.state,
  }) as unknown as BookShelfEntity;

const ids = (books: BookShelfEntity[]) => pickFinishedSeries(books).map((b) => b.id);

describe('pickFinishedSeries', () => {
  test('excludes finished books without a series', () => {
    expect(ids([make(1)])).toEqual([]);
  });

  test('excludes unfinished books', () => {
    expect(ids([make(1, { series: 's', status: 2, pos: 10, time: 1000 })])).toEqual([]);
  });

  test('keeps only the newest finished book of a series', () => {
    const books = [
      make(1, { series: 's', played: '2026-01-01T00:00:00Z' }),
      make(2, { series: 's', played: '2026-02-01T00:00:00Z' }),
    ];
    expect(ids(books)).toEqual([2]);
  });

  test('orders by positionUpdatedTime, falling back to stateUpdateTime', () => {
    const books = [
      make(1, { series: 'a', played: '2026-01-01T00:00:00Z' }),
      make(2, { series: 'b', state: '2026-03-01T00:00:00Z' }),
      make(3, { series: 'c', played: '2026-02-01T00:00:00Z' }),
    ];
    expect(ids(books)).toEqual([2, 3, 1]);
  });

  test('caps at 10 series', () => {
    const books = Array.from({ length: 12 }, (_, i) =>
      make(i, { series: `s${i}`, played: new Date(2026, 0, i + 1).toISOString() }),
    );
    expect(pickFinishedSeries(books)).toHaveLength(10);
  });

  test('counts status 3 and position >= 98% as finished', () => {
    const books = [
      make(1, { series: 'a', status: 3 }),
      make(2, { series: 'b', status: 2, pos: 980, time: 1000 }),
      make(3, { series: 'c', status: 2, pos: 979, time: 1000 }),
    ];
    expect(ids(books).sort()).toEqual([1, 2]);
  });
});
