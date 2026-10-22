// Series helpers for the Dashboard's "Continue series" row.
import type { BookShelfEntity } from '../interfaces/books';
import { isBookFinished } from './helpers';

// Series looked up per load; the server caches each lookup for an hour.
export const MAX_SERIES = 10;

/** Timestamp a shelf item is ranked by: last listened, else last state change. */
export const shelfTimestamp = (book: BookShelfEntity): number => {
  if (book.positionUpdatedTime) return new Date(book.positionUpdatedTime).getTime();
  if (book.stateUpdateTime) return new Date(book.stateUpdateTime).getTime();
  return 0;
};

/** Comparator for "most recently updated first". */
export const compareByRecency = (a: BookShelfEntity, b: BookShelfEntity): number =>
  shelfTimestamp(b) - shelfTimestamp(a);

/** Finished books with a series, newest first, one per series, at most MAX_SERIES. */
export function pickFinishedSeries(books: BookShelfEntity[]): BookShelfEntity[] {
  const seen = new Set<string>();
  const picked: BookShelfEntity[] = [];
  const finished = books
    .filter((b) => b.book?.seriesInfo?.id && isBookFinished(b))
    .sort(compareByRecency);
  for (const entity of finished) {
    const id = entity.book.seriesInfo?.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    picked.push(entity);
    if (picked.length >= MAX_SERIES) break;
  }
  return picked;
}
