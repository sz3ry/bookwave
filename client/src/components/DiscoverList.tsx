// Building blocks of the Discover front page plus the full vertical list
// behind a row's "See all".
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchResultBook } from '../interfaces/books';
import { getDiscoveryList } from '../utils/api';
import { buildCoverUrl, isOfflineError } from '../utils/helpers';

export function DiscoverSpinner() {
  return (
    <div className="flex-1 flex items-center justify-center py-10">
      <div className="w-8 h-8 border-2 border-[#FF5100] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/** Offline notice, or an error with a retry button. */
export function DiscoverNotice({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-gray-400"
    >
      <p>{offline ? t('discover.offline') : t('discover.error')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-4 py-2 rounded-xl bg-[#FF5100] text-white text-xs font-semibold shadow-md shadow-[#FF5100]/25 hover:brightness-110 transition-all"
      >
        {t('discover.retry')}
      </button>
    </div>
  );
}

interface DiscoverCardProps {
  book: SearchResultBook;
  selected: boolean;
  onSelect: (book: SearchResultBook) => void;
}

export function DiscoverCard({ book, selected, onSelect }: DiscoverCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(book)}
      className={`w-[120px] flex-shrink-0 text-left rounded-xl p-1.5 transition-colors ${
        selected ? 'bg-[#FF5100]/15 ring-1 ring-[#FF5100]/50' : 'hover:bg-white/[0.04]'
      }`}
    >
      <div className="w-full aspect-square rounded-lg overflow-hidden bg-gray-900 mb-1.5">
        {book.coverUrl && (
          <img
            src={buildCoverUrl(book.coverUrl)}
            alt={book.title}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        )}
      </div>
      <p className="text-xs font-semibold text-white line-clamp-2 leading-snug">{book.title}</p>
      <p className="text-[11px] text-gray-500 line-clamp-1">{book.authors}</p>
    </button>
  );
}

interface DiscoverListProps {
  title: string;
  itemsUrl: string;
  selectedBookId: string | null;
  onSelectBook: (book: SearchResultBook) => void;
  onBack: () => void;
}

export function DiscoverList({
  title,
  itemsUrl,
  selectedBookId,
  onSelectBook,
  onBack,
}: DiscoverListProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SearchResultBook[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ offline: boolean } | null>(null);
  const seqRef = useRef(0);

  const load = async (token?: string) => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getDiscoveryList(itemsUrl, token);
      if (seq !== seqRef.current) return;
      setItems((prev) => (token ? [...prev, ...res.items] : res.items));
      setNextPageToken(res.nextPageToken);
    } catch (err) {
      if (seq !== seqRef.current) return;
      console.error('Discover list failed:', err);
      setError({ offline: isOfflineError(err) });
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the list changes
  useEffect(() => {
    setItems([]);
    setNextPageToken(null);
    load();
    return () => {
      seqRef.current++;
    };
  }, [itemsUrl]);

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-y-auto custom-scrollbar py-5 bg-[#0A0A0A]">
      <div className="flex items-center gap-3 px-6 mb-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-white transition-colors"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          {t('discover.back')}
        </button>
        <h3 className="text-sm font-bold text-white truncate">{title}</h3>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-3 px-6">
          {items.map((book) => (
            <DiscoverCard
              key={book.id}
              book={book}
              selected={selectedBookId === book.id}
              onSelect={onSelectBook}
            />
          ))}
        </div>
      )}

      {error ? (
        <DiscoverNotice offline={error.offline} onRetry={() => load(nextPageToken ?? undefined)} />
      ) : loading ? (
        <DiscoverSpinner />
      ) : items.length === 0 ? (
        <p className="px-6 text-xs text-gray-500">{t('discover.empty')}</p>
      ) : (
        nextPageToken && (
          <div className="flex justify-center py-5">
            <button
              type="button"
              onClick={() => load(nextPageToken)}
              className="px-4 py-2 rounded-xl bg-white/[0.06] text-white text-xs font-semibold hover:bg-white/[0.1] transition-colors"
            >
              {t('discover.loadMore')}
            </button>
          </div>
        )
      )}
    </div>
  );
}

export default DiscoverList;
