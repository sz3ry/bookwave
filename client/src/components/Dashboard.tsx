import type React from 'react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../utils/api';
import BookCard from './BookCard';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import ContinueSeriesRow from './ContinueSeriesRow';
import ConfirmRemoveBookModal from './ConfirmRemoveBookModal';
import type { BookShelfEntity, BookShelfResponse } from '../interfaces/books';
import type { AudiotekaLibraryEntry, LibraryBook, ProviderId } from '../interfaces/library';
import {
  combineLibraries,
  fromAudiotekaEntry,
  fromShelfEntity,
  readAudiotekaLocalPosition,
} from '../utils/library';
import { useProviders } from '../contexts/ProvidersContext';
import { isOfflineError, removeFromBookshelfErrorKey } from '../utils/helpers';

// How often the offline Dashboard retries Storytel in the background.
const OFFLINE_RETRY_MS = 30_000;

const PROVIDER_NAME: Record<ProviderId, string> = {
  storytel: 'Storytel',
  audioteka: 'Audioteka',
};

/** Storytel bookshelf; `offline` when it lists only books downloaded to disk. */
interface StorytelShelf {
  entities: BookShelfEntity[];
  offline: boolean;
}

/** A provider's load result; null when the provider is not logged in. */
type ProviderLoad<T> = PromiseSettledResult<T> | null;

const settle = <T,>(promise: Promise<T>): Promise<PromiseSettledResult<T>> =>
  Promise.allSettled([promise]).then(([result]) => result);

/** Online bookshelf, or the downloaded books when Storytel is unreachable. */
async function loadStorytelShelf(): Promise<StorytelShelf> {
  try {
    const response = await api.get<BookShelfResponse>('/bookshelf');
    return { entities: response.data.books || [], offline: false };
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    console.warn('Failed to load bookshelf, falling back to downloaded books', err);
    const offline = await api.get<BookShelfResponse>('/offline/bookshelf');
    return { entities: offline.data?.books || [], offline: true };
  }
}

async function loadAudiotekaBooks(): Promise<LibraryBook[]> {
  const response = await api.get<AudiotekaLibraryEntry[]>('/audioteka/library');
  const entries = response.data || [];
  const locals = await Promise.all(entries.map((e) => readAudiotekaLocalPosition(e.id)));
  return entries.map((e, i) => fromAudiotekaEntry(e, locals[i]));
}

interface DashboardProps {
  onLogout: () => void;
  triggerLogout?: boolean;
  setTriggerLogout?: (value: boolean) => void;
}

export function Dashboard({ onLogout, triggerLogout, setTriggerLogout }: DashboardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { storytel: hasStorytel, audioteka: hasAudioteka } = useProviders();
  const [storytelShelf, setStorytelShelf] = useState<ProviderLoad<StorytelShelf>>(null);
  const [audiotekaBooks, setAudiotekaBooks] = useState<ProviderLoad<LibraryBook[]>>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<LibraryBook['status'] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [bookToRemove, setBookToRemove] = useState<BookShelfEntity | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Loads can overlap (mount, provider changes and 'bookshelfUpdated'); only the
  // latest one may update the list, so an older load cannot replace a newer result.
  const loadSeqRef = useRef(0);

  // Each logged-in provider loads on its own; one failing keeps the other's books.
  const loadLibrary = async () => {
    const seq = ++loadSeqRef.current;
    setIsLoading(true);
    const [storytel, audioteka] = await Promise.all([
      hasStorytel ? settle(loadStorytelShelf()) : null,
      hasAudioteka ? settle(loadAudiotekaBooks()) : null,
    ]);
    if (seq !== loadSeqRef.current) return;
    if (storytel?.status === 'rejected') {
      console.error('Failed to load bookshelf', storytel.reason);
    }
    if (audioteka?.status === 'rejected') {
      console.error('Failed to load Audioteka library', audioteka.reason);
    }
    setStorytelShelf(storytel);
    setAudiotekaBooks(audioteka);
    setIsLoading(false);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the logged-in providers change
  useEffect(() => {
    loadLibrary();
    const handleUpdate = () => {
      setFilterStatus(null);
      setSearchQuery('');
      loadLibrary();
    };
    window.addEventListener('bookshelfUpdated', handleUpdate);
    return () => {
      window.removeEventListener('bookshelfUpdated', handleUpdate);
    };
  }, [hasStorytel, hasAudioteka]);

  const storytelEntities =
    storytelShelf?.status === 'fulfilled' ? storytelShelf.value.entities : [];
  // Storytel was unreachable and its part lists only books downloaded to disk.
  const isOffline = storytelShelf?.status === 'fulfilled' && storytelShelf.value.offline;

  const { books, failed } = useMemo(
    () =>
      combineLibraries(
        storytelShelf?.status === 'fulfilled'
          ? { status: 'fulfilled', value: storytelShelf.value.entities.map(fromShelfEntity) }
          : storytelShelf,
        audiotekaBooks,
      ),
    [storytelShelf, audiotekaBooks],
  );
  const loggedInCount = Number(hasStorytel) + Number(hasAudioteka);
  // Every logged-in provider failed: nothing to show but the error page.
  const allFailed = failed.length > 0 && failed.length >= loggedInCount;

  // Background retry of the online bookshelf while offline: no loading state,
  // and a failure keeps the offline list as it is.
  const retryStorytelOnline = async () => {
    const seq = loadSeqRef.current;
    try {
      const response = await api.get<BookShelfResponse>('/bookshelf');
      if (seq !== loadSeqRef.current) return;
      setStorytelShelf({
        status: 'fulfilled',
        value: { entities: response.data.books || [], offline: false },
      });
    } catch {
      // Still offline; try again later.
    }
  };

  // While showing the offline list, switch back to the online bookshelf as soon
  // as Storytel is reachable again, without a manual reload.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the retry only depends on the offline flag
  useEffect(() => {
    if (!isOffline) return;
    const retry = () => {
      void retryStorytelOnline();
    };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    const timer = window.setInterval(retry, OFFLINE_RETRY_MS);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      window.clearInterval(timer);
    };
  }, [isOffline]);

  // Status counts
  const counts = useMemo(() => {
    let notStarted = 0;
    let started = 0;
    let concluded = 0;

    for (const b of books) {
      if (b.status === 'concluded') concluded += 1;
      else if (b.status === 'started') started += 1;
      else notStarted += 1;
    }

    return {
      all: books.length,
      notStarted,
      started,
      concluded,
    };
  }, [books]);

  // Filtered books, already ordered most recent first by combineLibraries
  const filteredBooks = useMemo(() => {
    if (books.length === 0) return [];

    let result = books;

    // Filter by status if selected
    if (filterStatus !== null) {
      result = result.filter((book) => book.status === filterStatus);
    }

    // Filter by local search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((book) => {
        const narrators =
          book.storytel?.abook?.narratorAsString ?? book.audioteka?.narrators.join(', ');
        return (
          book.title.toLowerCase().includes(q) ||
          book.authors.toLowerCase().includes(q) ||
          narrators?.toLowerCase().includes(q)
        );
      });
    }

    return result;
  }, [books, filterStatus, searchQuery]);

  const handleBookSelect = (book: LibraryBook) => {
    if (book.audioteka) {
      navigate(`/player/audioteka/${book.audioteka.id}`, {
        state: { audiotekaBook: book.audioteka },
      });
      return;
    }
    if (!book.storytel) return;
    const bookId = book.storytel.abook?.id || book.storytel.id;
    navigate(`/book/${bookId}`, {
      state: { book: book.storytel },
    });
  };

  const handleQuickPlay = (e: React.MouseEvent, book: LibraryBook) => {
    e.stopPropagation();
    if (book.audioteka) {
      navigate(`/player/audioteka/${book.audioteka.id}`, {
        state: { audiotekaBook: book.audioteka, autoPlay: true },
      });
      return;
    }
    if (!book.storytel) return;
    const bookId = book.storytel.abook?.id || book.storytel.id;
    navigate(`/player/${bookId}`, {
      state: { book: book.storytel, autoPlay: true },
    });
  };

  // Only Storytel books can be removed, and not while Storytel is unreachable.
  const handleRemoveRequest = (book: LibraryBook) => {
    if (book.storytel) setBookToRemove(book.storytel);
  };

  const handleRemoveBook = async () => {
    if (!bookToRemove || isRemoving) return;
    const consumableId = bookToRemove.book?.consumableId || bookToRemove.id;
    if (!consumableId) return;

    try {
      setIsRemoving(true);
      await api.post('/bookshelf/remove', { consumableId: String(consumableId) });
      setBookToRemove(null);
      setStorytelShelf((prev) =>
        prev?.status === 'fulfilled'
          ? {
              ...prev,
              value: {
                ...prev.value,
                entities: prev.value.entities.filter((b) => b !== bookToRemove),
              },
            }
          : prev,
      );
      setToastMessage({
        type: 'success',
        text: t('bookshelf.removed', 'Removed from your library'),
      });
      loadLibrary();
    } catch (err: any) {
      console.error('Failed to remove book from bookshelf:', err);
      setBookToRemove(null);
      setToastMessage({ type: 'error', text: t(removeFromBookshelfErrorKey(err)) });
    } finally {
      setIsRemoving(false);
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  if (isLoading) {
    return <LoadingState message={t('dashboard.loading', 'Loading your library...')} />;
  }

  if (allFailed) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white">
        <ErrorState
          error={t('dashboard.loadError')}
          onRetry={() => window.location.reload()}
          onLogout={onLogout}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#0A0A0A] text-white selection:bg-[#FF5100] selection:text-white overflow-y-auto custom-scrollbar">
      <main className="max-w-7xl mx-auto py-7 px-6 pb-28">
        {/* Top Header & Search Toolbar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
              <span>{t('dashboard.title', 'My Library')}</span>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#1A1A1A] border border-white/10 text-gray-400">
                {t('dashboard.bookCount', { count: books.length })}
              </span>
            </h1>
          </div>

          {/* Quick filter in library */}
          <div className="relative w-full md:w-72">
            <div className="relative flex items-center bg-[#1A1A1A] border border-white/[0.08] focus-within:border-[#FF5100]/60 focus-within:ring-1 focus-within:ring-[#FF5100]/30 rounded-xl px-3.5 h-10 transition-all shadow-inner">
              <svg
                className="w-4 h-4 text-gray-400 flex-shrink-0 mr-2.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
                />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('dashboard.search', 'Search my library...')}
                className="w-full bg-transparent text-white placeholder-gray-500 text-xs focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-gray-400 hover:text-white ml-1.5 p-1 rounded-full hover:bg-white/10"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {isOffline && (
          <div
            role="status"
            className="flex items-center gap-2.5 mb-5 px-4 py-2.5 rounded-xl bg-[#FF5100]/10 border border-[#FF5100]/30 text-xs text-[#FFB38A]"
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4 flex-shrink-0 text-[#FF5100]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 3l18 18M8.5 16.4a5 5 0 017 0M5 12.9a10 10 0 015.2-2.8M19 12.9a10 10 0 00-2.4-1.8M1.4 9.4a15 15 0 014.3-2.8M22.6 9.4A15 15 0 0010.5 5.1M12 20h.01"
              />
            </svg>
            <span>{t('dashboard.offlineNotice')}</span>
          </div>
        )}

        {failed.map((provider) => (
          <div
            key={provider}
            role="status"
            className="flex items-center gap-2.5 mb-5 px-4 py-2.5 rounded-xl bg-[#FF5100]/10 border border-[#FF5100]/30 text-xs text-[#FFB38A]"
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4 flex-shrink-0 text-[#FF5100]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"
              />
            </svg>
            <span>{t('library.providerUnavailable', { provider: PROVIDER_NAME[provider] })}</span>
          </div>
        ))}

        {/* Filter Status Tabs */}
        <div className="flex items-center gap-2 mb-7 overflow-x-auto pb-1 no-scrollbar border-b border-white/[0.06] pt-1">
          {[
            { status: null, label: t('dashboard.filters.all', 'All'), count: counts.all },
            {
              status: 'started' as const,
              label: t('dashboard.filters.started', 'Started'),
              count: counts.started,
            },
            {
              status: 'notStarted' as const,
              label: t('dashboard.filters.notStarted', 'Not started'),
              count: counts.notStarted,
            },
            {
              status: 'concluded' as const,
              label: t('dashboard.filters.concluded', 'Concluded'),
              count: counts.concluded,
            },
          ].map(({ status, label, count }) => {
            const isActive = filterStatus === status;
            return (
              <button
                key={String(status)}
                type="button"
                onClick={() => setFilterStatus(status)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all select-none ${
                  isActive
                    ? 'bg-[#FF5100]/15 text-[#FF5100] border border-[#FF5100]/40 shadow-sm'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <span>{label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    isActive ? 'bg-[#FF5100] text-white' : 'bg-[#222225] text-gray-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {hasStorytel && <ContinueSeriesRow books={storytelEntities} offline={isOffline} />}

        {/* Book Grid */}
        {books.length === 0 ? (
          <div className="text-center py-20 bg-[#141414] border border-white/[0.06] rounded-3xl p-8 max-w-lg mx-auto shadow-2xl">
            <div className="w-16 h-16 mx-auto mb-4 bg-white/[0.04] border border-white/[0.08] rounded-2xl flex items-center justify-center text-gray-500">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </div>
            <h3 className="text-white text-lg font-bold mb-1">
              {t('dashboard.noBooks', 'No books found')}
            </h3>
            <p className="text-gray-400 text-xs max-w-sm mx-auto mb-5">
              {t('dashboard.emptyLibrary', 'Your library appears to be empty.')}
            </p>
            <button
              type="button"
              onClick={() => navigate('/search')}
              className="px-5 py-2.5 rounded-xl bg-[#FF5100] text-white text-xs font-bold shadow-lg shadow-[#FF5100]/30 hover:brightness-110 active:scale-95 transition-all"
            >
              {t('dashboard.exploreCatalog', 'Explore the catalog (⌘K)')}
            </button>
          </div>
        ) : filteredBooks.length === 0 ? (
          <div className="text-center py-16 bg-[#141414] border border-white/[0.06] rounded-3xl p-8 space-y-3 max-w-lg mx-auto shadow-xl">
            <p className="text-gray-300 text-sm font-medium">
              {t('dashboard.noFilterMatch', 'No books matched your filter.')}
            </p>
            <button
              type="button"
              onClick={() => {
                setFilterStatus(null);
                setSearchQuery('');
              }}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white font-semibold transition-all"
            >
              {t('dashboard.resetFilters', 'Reset filters')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
            {filteredBooks
              .filter((book) => !book.storytel || !!book.storytel.abook || !!book.storytel.book)
              .map((book) => (
                <BookCard
                  key={book.key}
                  book={book}
                  onBookSelect={handleBookSelect}
                  // Removing needs Storytel, which is unreachable offline; Audioteka
                  // books cannot be removed from Bookwave.
                  onRemove={book.storytel && !isOffline ? handleRemoveRequest : undefined}
                  onQuickPlay={handleQuickPlay}
                />
              ))}
          </div>
        )}
      </main>

      <ConfirmRemoveBookModal
        isOpen={!!bookToRemove}
        bookTitle={bookToRemove?.book?.name || ''}
        isRemoving={isRemoving}
        onConfirm={handleRemoveBook}
        onCancel={() => setBookToRemove(null)}
      />

      {toastMessage && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-medium shadow-2xl backdrop-blur-md border animate-in fade-in slide-in-from-bottom-2 ${
            toastMessage.type === 'success'
              ? 'bg-green-950/90 text-green-300 border-green-700/50'
              : 'bg-red-950/90 text-red-300 border-red-700/50'
          }`}
        >
          {toastMessage.text}
        </div>
      )}
    </div>
  );
}

export default Dashboard;
