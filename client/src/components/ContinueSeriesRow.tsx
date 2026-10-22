// Dashboard row suggesting the next audiobook part of series the user finished.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { BookShelfEntity, SearchResultBook } from '../interfaces/books';
import { getDiscoverySeries } from '../utils/api';
import { isBookFinished } from '../utils/helpers';
import { DiscoverCard } from './DiscoverList';

// Series looked up per load; the server caches each lookup for an hour.
const MAX_SERIES = 10;

const recency = (book: BookShelfEntity): number => {
  if (book.positionUpdatedTime) return new Date(book.positionUpdatedTime).getTime();
  if (book.stateUpdateTime) return new Date(book.stateUpdateTime).getTime();
  return 0;
};

/** Finished books with a series, newest first, one per series, at most MAX_SERIES. */
export function pickFinishedSeries(books: BookShelfEntity[]): BookShelfEntity[] {
  const seen = new Set<string>();
  const picked: BookShelfEntity[] = [];
  const finished = books
    .filter((b) => b.book?.seriesInfo?.id && isBookFinished(b))
    .sort((a, b) => recency(b) - recency(a));
  for (const entity of finished) {
    const id = entity.book.seriesInfo?.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    picked.push(entity);
    if (picked.length >= MAX_SERIES) break;
  }
  return picked;
}

interface ContinueSeriesRowProps {
  books: BookShelfEntity[];
  offline: boolean;
}

export function ContinueSeriesRow({ books, offline }: ContinueSeriesRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<SearchResultBook[]>([]);

  useEffect(() => {
    // `cancelled` drops results of a previous books list or an offline switch.
    let cancelled = false;
    setSuggestions([]);
    if (offline) return;
    const picked = pickFinishedSeries(books);
    if (picked.length === 0) return;
    const owned = new Set(books.map((b) => String(b.book?.consumableId)));
    Promise.all(
      picked.map((entity) =>
        getDiscoverySeries(
          entity.book.seriesInfo?.id as string,
          entity.book.seriesInfo?.orderInSeries,
        )
          .then((s) => s.next)
          .catch(() => null),
      ),
    ).then((nexts) => {
      if (cancelled) return;
      const seen = new Set<string>();
      const result: SearchResultBook[] = [];
      for (const next of nexts) {
        if (!next || owned.has(next.id) || seen.has(next.id)) continue;
        seen.add(next.id);
        result.push(next);
      }
      setSuggestions(result);
    });
    return () => {
      cancelled = true;
    };
  }, [books, offline]);

  if (offline || suggestions.length === 0) return null;

  // Suggestions are never on the shelf, so they open in the search preview pane.
  const open = (book: SearchResultBook) => navigate('/search', { state: { selectBook: book } });

  return (
    <section className="mb-7" aria-label={t('dashboard.continueSeries')}>
      <h2 className="text-sm font-bold text-white mb-2">{t('dashboard.continueSeries')}</h2>
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {suggestions.map((book) => (
          <DiscoverCard key={book.id} book={book} selected={false} onSelect={open} />
        ))}
      </div>
    </section>
  );
}

export default ContinueSeriesRow;
