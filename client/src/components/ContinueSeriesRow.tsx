// Dashboard row suggesting the next audiobook part of series the user finished.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SearchResultBook } from '../interfaces/books';
import { useCatalog } from '../catalog';
import { candidateBookId, pickFinishedSeries, type SeriesCandidate } from '../utils/series';
import { DiscoverCard } from './DiscoverList';

interface ContinueSeriesRowProps {
  // The active service's library books that may lead to a next part.
  candidates: SeriesCandidate[];
  // Book ids already in that library; such next parts are not suggested.
  ownedIds: Set<string>;
  offline: boolean;
}

export function ContinueSeriesRow({ candidates, ownedIds, offline }: ContinueSeriesRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [suggestions, setSuggestions] = useState<SearchResultBook[]>([]);

  // Stable keys so unrelated library changes do not refire the lookups.
  const picked = pickFinishedSeries(candidates);
  const pickedKey = picked.map((c) => `${c.key}:${c.seriesId}:${c.orderInSeries ?? ''}`).join('|');
  const ownedKey = [...ownedIds].sort().join('|');

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on pickedKey, ownedKey and the catalog
  useEffect(() => {
    // `cancelled` drops results of a previous key or an offline switch.
    let cancelled = false;
    if (offline || picked.length === 0) {
      setSuggestions([]);
      return;
    }
    const owned = new Set(ownedKey.split('|'));
    Promise.all(
      picked.map((candidate) =>
        catalog
          .series(candidate.seriesId, {
            order: candidate.orderInSeries,
            bookId: candidateBookId(candidate),
          })
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
  }, [pickedKey, ownedKey, offline, catalog]);

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
