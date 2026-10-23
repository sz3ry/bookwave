// Series helpers for the Dashboard's "Continue series" row.
import type { BookShelfEntity, SeriesInfo } from '../interfaces/books';
import type { LibraryBook } from '../interfaces/library';
import { isBookFinished } from './helpers';

// Series looked up per load; the server caches each lookup for an hour.
export const MAX_SERIES = 10;

// Audioteka book pages looked up at once while building candidates.
const AUDIOTEKA_LOOKUP_CONCURRENCY = 3;

/** A library book that may lead to the next part of its series. */
export interface SeriesCandidate {
  /** `storytel:<consumableId>` or `audioteka:<id>`. */
  key: string;
  /** Empty when the book belongs to no series. */
  seriesId: string;
  orderInSeries: number | null;
  finished: boolean;
  /** ISO timestamp of the last activity; candidates are ranked by it. */
  timestamp: string | null;
}

/** The provider's book id inside a candidate key. */
export const candidateBookId = (candidate: SeriesCandidate): string =>
  candidate.key.slice(candidate.key.indexOf(':') + 1);

const timeOf = (candidate: SeriesCandidate): number => {
  const time = candidate.timestamp ? new Date(candidate.timestamp).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
};

/** Finished books with a series, newest first, one per series, at most MAX_SERIES. */
export function pickFinishedSeries(items: SeriesCandidate[]): SeriesCandidate[] {
  const seen = new Set<string>();
  const picked: SeriesCandidate[] = [];
  const finished = items
    .filter((c) => c.seriesId && c.finished)
    .sort((a, b) => timeOf(b) - timeOf(a));
  for (const candidate of finished) {
    if (seen.has(candidate.seriesId)) continue;
    seen.add(candidate.seriesId);
    picked.push(candidate);
    if (picked.length >= MAX_SERIES) break;
  }
  return picked;
}

/**
 * Storytel shelf entry as a candidate, ranked by last listened, else last
 * state change; null when the shelf names no series for it.
 */
export function shelfCandidate(entity: BookShelfEntity): SeriesCandidate | null {
  const series = entity.book?.seriesInfo;
  if (!series?.id) return null;
  return {
    key: `storytel:${entity.book.consumableId}`,
    seriesId: String(series.id),
    orderInSeries: series.orderInSeries ?? null,
    finished: isBookFinished(entity),
    timestamp: entity.positionUpdatedTime || entity.stateUpdateTime || null,
  };
}

/** Runs `task` over `items` with at most `limit` tasks in flight; order is kept. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Candidates of the Audioteka library: its library list carries no series, so
 * the most recent concluded books (at most MAX_SERIES) are looked up one by
 * one; a failed lookup only drops that book.
 */
export async function audiotekaCandidates(
  books: LibraryBook[],
  seriesInfo: (id: string) => Promise<SeriesInfo | null>,
  concurrency = AUDIOTEKA_LOOKUP_CONCURRENCY,
): Promise<SeriesCandidate[]> {
  const recent = books
    .filter((b) => b.provider === 'audioteka' && b.status === 'concluded')
    .map(
      (b): SeriesCandidate => ({
        key: b.key,
        seriesId: '',
        orderInSeries: null,
        finished: true,
        timestamp: b.lastActivity,
      }),
    )
    // `lastActivity` is the position saved on this device only (Audioteka's
    // library carries no listening time), so books concluded elsewhere rank last.
    .sort((a, b) => timeOf(b) - timeOf(a))
    .slice(0, MAX_SERIES);
  const infos = await mapWithConcurrency(recent, concurrency, (candidate) =>
    seriesInfo(candidateBookId(candidate)).catch(() => null),
  );
  return recent.flatMap((candidate, i) => {
    const info = infos[i];
    return info?.id ? [{ ...candidate, seriesId: info.id, orderInSeries: info.orderInSeries }] : [];
  });
}
