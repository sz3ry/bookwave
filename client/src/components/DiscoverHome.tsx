// Storytel's front page, shown in the search view while the query is empty:
// chips as tabs, one horizontal row per block, "See all" for the full list.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DiscoveryChip,
  DiscoveryPage,
  DiscoveryRow,
  SearchResultBook,
} from '../interfaces/books';
import { getDiscoveryChips, getDiscoveryList, getDiscoveryPage } from '../utils/api';
import { isOfflineError } from '../utils/helpers';
import DiscoverList, { DiscoverCard, DiscoverNotice, DiscoverSpinner } from './DiscoverList';

interface DiscoverHomeProps {
  selectedBookId: string | null;
  onSelectBook: (book: SearchResultBook) => void;
}

interface LoadError {
  offline: boolean;
}

export function DiscoverHome({ selectedBookId, onSelectBook }: DiscoverHomeProps) {
  const { t } = useTranslation();
  const [chips, setChips] = useState<DiscoveryChip[] | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [rows, setRows] = useState<DiscoveryRow[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const [openList, setOpenList] = useState<{ title: string; itemsUrl: string } | null>(null);
  const [rowFailures, setRowFailures] = useState<Record<string, LoadError>>({});
  const [epoch, setEpoch] = useState(0);
  const seqRef = useRef(0);

  const loadPage = async (slug: string, token?: string) => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const page: DiscoveryPage = await getDiscoveryPage(slug, token);
      if (seq !== seqRef.current) return;
      setRows((prev) => (token ? [...prev, ...page.rows] : page.rows));
      setNextPageToken(page.nextPageToken);
    } catch (err) {
      if (seq !== seqRef.current) return;
      console.error('Discover page failed:', err);
      setError({ offline: isOfflineError(err) });
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  const loadChips = async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const list = await getDiscoveryChips();
      if (seq !== seqRef.current) return;
      setChips(list);
      if (list.length === 0) {
        setLoading(false);
        return;
      }
      setActiveSlug(list[0].pageSlug);
      await loadPage(list[0].pageSlug);
    } catch (err) {
      if (seq !== seqRef.current) return;
      console.error('Discover chips failed:', err);
      setError({ offline: isOfflineError(err) });
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    loadChips();
    return () => {
      seqRef.current++;
    };
  }, []);

  const selectChip = (slug: string) => {
    if (slug === activeSlug) return;
    setActiveSlug(slug);
    setRows([]);
    setNextPageToken(null);
    reloadPage(slug);
  };

  // Row failures are reset (and rows remounted) whenever the page is reloaded.
  const reloadPage = (slug: string) => {
    setRowFailures({});
    setEpoch((n) => n + 1);
    loadPage(slug);
  };

  const retry = () => {
    if (chips && activeSlug) {
      // Resume a failed "Load more" instead of replacing the rows already shown.
      if (rows.length > 0 && nextPageToken) {
        loadPage(activeSlug, nextPageToken);
      } else {
        reloadPage(activeSlug);
      }
    } else {
      loadChips();
    }
  };

  // Every lazy row failed and no inline row has books: show the page-level
  // notice instead of an empty page.
  const failedRows = Object.values(rowFailures);
  const lazyRowCount = rows.filter((row) => row.itemsUrl && row.items.length === 0).length;
  const hasInlineItems = rows.some((row) => row.items.length > 0);
  const allRowsFailed = lazyRowCount > 0 && failedRows.length >= lazyRowCount && !hasInlineItems;
  const shownError =
    error ?? (allRowsFailed ? { offline: failedRows.every((f) => f.offline) } : null);

  if (openList) {
    return (
      <DiscoverList
        title={openList.title}
        itemsUrl={openList.itemsUrl}
        selectedBookId={selectedBookId}
        onSelectBook={onSelectBook}
        onBack={() => setOpenList(null)}
      />
    );
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-y-auto custom-scrollbar py-5 bg-[#0A0A0A]">
      {chips && chips.length > 1 && (
        <div
          role="tablist"
          className="flex flex-shrink-0 gap-2 overflow-x-auto custom-scrollbar px-6 pt-1 pb-4"
        >
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={chip.pageSlug === activeSlug}
              onClick={() => selectChip(chip.pageSlug)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                chip.pageSlug === activeSlug
                  ? 'bg-[#FF5100] text-white'
                  : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.1]'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {rows.map((row) => (
        <DiscoverRowView
          key={`${epoch}:${activeSlug}:${row.id}`}
          row={row}
          selectedBookId={selectedBookId}
          onSelectBook={onSelectBook}
          onFailed={(failure) => setRowFailures((prev) => ({ ...prev, [row.id]: failure }))}
          onSeeAll={(itemsUrl) => setOpenList({ title: row.title, itemsUrl })}
        />
      ))}

      {shownError ? (
        <DiscoverNotice offline={shownError.offline} onRetry={retry} />
      ) : loading ? (
        <DiscoverSpinner />
      ) : rows.length === 0 ? (
        <p className="px-6 text-xs text-gray-500">{t('discover.empty')}</p>
      ) : (
        nextPageToken &&
        activeSlug && (
          <div className="flex justify-center py-3">
            <button
              type="button"
              onClick={() => loadPage(activeSlug, nextPageToken)}
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

function DiscoverRowView({
  row,
  selectedBookId,
  onSelectBook,
  onFailed,
  onSeeAll,
}: {
  row: DiscoveryRow;
  selectedBookId: string | null;
  onSelectBook: (book: SearchResultBook) => void;
  onFailed: (failure: LoadError) => void;
  onSeeAll: (itemsUrl: string) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SearchResultBook[] | null>(
    row.items.length > 0 || !row.itemsUrl ? row.items : null,
  );

  // Lazy rows load their first page on mount. `onFailed` only calls a state setter,
  // so it is left out of the deps to keep a parent re-render from restarting the request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (items || !row.itemsUrl) return;
    let cancelled = false;
    getDiscoveryList(row.itemsUrl)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        console.error('Discover row failed:', row.id, err);
        if (cancelled) return;
        setItems([]);
        onFailed({ offline: isOfflineError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [row, items]);

  // Rows with nothing playable (e.g. an empty personalised row) are hidden.
  if (items && items.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between px-6 mb-2.5">
        <h3 className="text-sm font-bold text-white">{row.title}</h3>
        {row.itemsUrl && (
          <button
            type="button"
            onClick={() => row.itemsUrl && onSeeAll(row.itemsUrl)}
            className="text-xs font-semibold text-[#FF5100] hover:brightness-125 transition-all"
          >
            {t('discover.seeAll')}
          </button>
        )}
      </div>
      {items ? (
        <div className="flex gap-3 overflow-x-auto custom-scrollbar px-6 pb-2">
          {items.map((book) => (
            <DiscoverCard
              key={book.id}
              book={book}
              selected={selectedBookId === book.id}
              onSelect={onSelectBook}
            />
          ))}
        </div>
      ) : (
        <div className="px-6 h-[170px]" />
      )}
    </section>
  );
}

export default DiscoverHome;
