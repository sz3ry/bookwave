import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiscoverySeries, SearchResultBook, SeriesInfo } from '../interfaces/books';
import api, { getDiscoverySeries } from '../utils/api';

interface SeriesHintProps {
  seriesInfo: SeriesInfo;
  currentBookId: string;
  // The book is concluded: offer the next part as the primary action.
  finished: boolean;
  onOpenBook: (book: SearchResultBook) => void;
}

// Series info of a book. Hits from the storytel.com fallback search carry none,
// so it is read from the book-details call when `known` is missing.
export function useSeriesInfo(
  bookId: string,
  known?: SeriesInfo | null,
  fetchWhenMissing = true,
): SeriesInfo | null {
  const [fetched, setFetched] = useState<SeriesInfo | null>(null);

  useEffect(() => {
    setFetched(null);
    if (known || !bookId || !fetchWhenMissing) return;
    let cancelled = false;
    api
      .get(`/book-details/${encodeURIComponent(bookId)}`)
      .then((res) => {
        const raw = res.data?.seriesInfo;
        if (cancelled || !raw?.id) return;
        setFetched({
          id: String(raw.id),
          name: String(raw.name ?? ''),
          orderInSeries: typeof raw.orderInSeries === 'number' ? raw.orderInSeries : null,
        });
      })
      .catch(() => {
        /* no hint without series info */
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, known, fetchWhenMissing]);

  return known ?? fetched;
}

export function SeriesHint({ seriesInfo, currentBookId, finished, onOpenBook }: SeriesHintProps) {
  const { t } = useTranslation();
  const [series, setSeries] = useState<DiscoverySeries | null>(null);

  const seriesId = seriesInfo.id;
  const order = seriesInfo.orderInSeries;

  useEffect(() => {
    setSeries(null);
    let cancelled = false;
    getDiscoverySeries(seriesId, order)
      .then((data) => {
        if (!cancelled) setSeries(data);
      })
      .catch((err) => console.error('Series load failed:', err));
    return () => {
      cancelled = true;
    };
  }, [seriesId, order]);

  const seriesName = seriesInfo.name || series?.title || '';
  const firstOrder = series?.first?.seriesInfo?.orderInSeries ?? null;
  const startTarget =
    series && order != null && order > 1 && firstOrder != null && firstOrder < order
      ? series.firstIsAudiobook
        ? series.first
        : series.firstAudiobook
      : null;
  const showStart = !!startTarget && startTarget.id !== currentBookId;
  const showFirstUnavailable = !!series?.first && !series.firstIsAudiobook;
  const showNext = finished && !!series?.next && series.next.id !== currentBookId;

  const actionClass =
    'mt-2 w-full text-left px-3 py-2 rounded-lg bg-[#FF5100]/15 text-[#FF8A50] hover:bg-[#FF5100]/25 text-xs font-semibold transition-colors';
  const primaryActionClass =
    'mt-2 w-full text-left px-3 py-2 rounded-lg bg-[#FF5100] hover:bg-[#ff641a] text-white text-xs font-bold shadow-md shadow-[#FF5100]/25 transition-colors';

  return (
    <div className="mb-5 w-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[13px]">
      <p className="text-gray-200 font-semibold">
        {order != null
          ? t('series.partOf', { n: order, series: seriesName })
          : t('series.inSeries', { series: seriesName })}
      </p>

      {showNext && series?.next && (
        <button
          type="button"
          onClick={() => onOpenBook(series.next!)}
          className={primaryActionClass}
        >
          {t('series.next', { title: series.next.title })}
        </button>
      )}

      {showFirstUnavailable && (
        <p className="mt-2 text-xs text-gray-500">
          {t('series.firstUnavailable', { n: firstOrder })}
        </p>
      )}
      {showStart && startTarget && (
        <button type="button" onClick={() => onOpenBook(startTarget)} className={actionClass}>
          {t('series.startWith', {
            n: startTarget.seriesInfo?.orderInSeries ?? firstOrder,
            title: startTarget.title,
          })}
        </button>
      )}

      {series && series.parts.length > 1 && (
        <>
          <h4 className="mt-3 mb-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
            {t('series.parts')}
          </h4>
          <ol className="max-h-48 overflow-y-auto custom-scrollbar space-y-0.5">
            {series.parts.map((part) => {
              const isCurrent = part.id === currentBookId;
              const disabled = isCurrent || !part.hasAbook;
              return (
                <li key={part.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onOpenBook(part)}
                    className={`w-full text-left px-2 py-1 rounded-md text-xs truncate ${
                      isCurrent
                        ? 'text-[#FF8A50] font-semibold'
                        : part.hasAbook
                          ? 'text-gray-300 hover:bg-white/[0.05]'
                          : 'text-gray-600 cursor-not-allowed'
                    }`}
                    title={part.title}
                  >
                    <span className="inline-block w-6 text-gray-500">
                      {part.seriesInfo?.orderInSeries ?? '–'}
                    </span>
                    {part.title}
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

export default SeriesHint;
