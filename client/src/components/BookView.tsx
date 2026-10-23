import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  BookShelfEntity,
  BookShelfResponse,
  SearchResultBook,
  SeriesInfo,
} from '../interfaces/books';
import type { AudiotekaLibraryEntry, ProviderId } from '../interfaces/library';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import Navbar from './Navbar';
import {
  addToBookshelfErrorKey,
  buildCoverUrl,
  isBookFinished,
  localizedLanguageName,
  removeFromBookshelfErrorKey,
  truncateTitle,
} from '../utils/helpers';
import ConfirmRemoveBookModal from './ConfirmRemoveBookModal';
import SeriesHint, { useSeriesInfo } from './SeriesHint';
import { DiscoverCard } from './DiscoverList';
import { audiotekaCatalog, type BookPageData, storytelCatalog } from '../catalog';
import { useProviders } from '../contexts/ProvidersContext';
import { isOtherServiceRoute } from '../utils/activeService';
import api from '../utils/api';
import '../types/window.d.ts';

interface BookViewProps {
  // The service the route belongs to; a page of the inactive service redirects home.
  provider: ProviderId;
}

/** What the page shows, from the Storytel shelf entry or the catalogue's book page. */
interface BookDisplay {
  id: string;
  title: string;
  authors: { id?: string; name: string }[];
  narrators: string;
  coverUrl: string;
  durationMs: number;
  category: string;
}

const splitNames = (names: string): { name: string }[] =>
  names
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));

const shelfAuthors = (entity: BookShelfEntity): { id?: string; name: string }[] => {
  const named = (entity.book.authors || []).filter((a) => a?.name);
  return named.length
    ? named.map((a) => ({ id: String(a.id), name: a.name }))
    : splitNames(entity.book.authorsAsString || '');
};

// Storytel shelf entries carry microseconds.
const fromShelfEntry = (entity: BookShelfEntity, id: string): BookDisplay => ({
  id,
  title: entity.book.name,
  authors: shelfAuthors(entity),
  narrators: entity.abook?.narratorAsString || '',
  coverUrl: entity.book.largeCover || entity.book.largeCoverE,
  durationMs: (entity.abook?.time || 0) / 1000,
  category: entity.book.category?.title || '',
});

const fromPageBook = (book: SearchResultBook): BookDisplay => ({
  id: book.id,
  title: book.title,
  authors: book.authorRefs?.length ? book.authorRefs : splitNames(book.authors),
  narrators: book.narrators,
  coverUrl: book.coverUrl,
  durationMs: book.durationMs,
  category: book.category,
});

function BookViewContent({ provider }: BookViewProps) {
  const { t, i18n } = useTranslation();
  const { bookId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { active } = useProviders();
  const catalog = provider === 'audioteka' ? audiotekaCatalog : storytelCatalog;
  // Author lists and recommendation previews open in the active service's
  // search, so they are offered only for a book of that service.
  const isActiveService = active === provider;

  const [error, setError] = useState('');
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [page, setPage] = useState<BookPageData | null>(null);

  // A Storytel book opened from the library, the player or a series part.
  const stateBook: BookShelfEntity | null =
    provider === 'storytel' ? location.state?.book || null : null;
  // An Audioteka book opened from the library; it plays like the library card.
  const stateEntry: AudiotekaLibraryEntry | null =
    provider === 'audioteka' && location.state?.audiotekaBook?.id === bookId
      ? location.state.audiotekaBook
      : null;
  // The id the catalogue knows the book by (the route may carry a Storytel abook id).
  const pageId = String(stateBook?.book?.consumableId || bookId || '');

  const display: BookDisplay | null = stateBook
    ? fromShelfEntry(stateBook, pageId)
    : page
      ? fromPageBook(page.book)
      : null;
  // Description, language and series come from the book page, which the shelf
  // entry does not replace; the shelf's series wins when it has one.
  const description = page?.book.description || '';
  const language = page
    ? localizedLanguageName(page.book.language, i18n.language, page.book.languageName)
    : '';
  const detailsSeries: SeriesInfo | null = page?.book.seriesInfo ?? null;
  // Series info comes from the shelf entry or the book page, so the hook never
  // fetches on its own here.
  const seriesInfo = useSeriesInfo('', stateBook?.book?.seriesInfo ?? detailsSeries, false);
  const finished = stateBook
    ? isBookFinished(stateBook)
    : !!stateEntry && location.state?.finished === true;
  const isLoading = !stateBook && !page && !error;

  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(!!stateBook);
  // Only some library entries can be removed (Audioteka: favourites only).
  const [removable, setRemovable] = useState(!!stateBook);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [saveToast, setSaveToast] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  // With a shelf entry the page shows at once and the book page only adds
  // details, so its failure is silent; without one the page needs it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded once per book; the key resets the view
  useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    catalog
      .bookPage(pageId)
      .then((data) => {
        if (cancelled) return;
        setPage(data);
        if (!stateBook) {
          setIsSaved(data.inLibrary);
          setRemovable(data.removable);
        }
      })
      .catch((err) => {
        if (cancelled || stateBook) return;
        console.error('Failed to fetch book details:', err);
        setError(t('bookView.loadError', 'Failed to load book details'));
      });
    return () => {
      cancelled = true;
    };
  }, [catalog, pageId]);

  useEffect(() => {
    if (display) {
      document.title = truncateTitle(display.title);
    }

    return () => {
      document.title = 'Bookwave';
    };
  }, [display?.title]);

  const handleSaveToLibrary = async () => {
    if (isSaved || isSaving || !pageId) return;

    try {
      setIsSaving(true);
      await catalog.addToLibrary(pageId);
      setIsSaved(true);
      setRemovable(true);
      window.dispatchEvent(new Event('bookshelfUpdated'));
      setSaveToast({
        type: 'success',
        text: t('bookView.savedToLibrary', 'Book added to your library!'),
      });
      setTimeout(() => setSaveToast(null), 3000);
    } catch (err: any) {
      console.error('Failed to add book to bookshelf:', err);
      setSaveToast({
        type: 'error',
        text: t(addToBookshelfErrorKey(err)),
      });
      setTimeout(() => setSaveToast(null), 4500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveFromLibrary = async () => {
    if (!pageId || isSaving) return;

    try {
      setIsSaving(true);
      await catalog.removeFromLibrary(pageId);
      setIsSaved(false);
      setRemovable(false);
      setShowRemoveConfirm(false);
      window.dispatchEvent(new Event('bookshelfUpdated'));
      setSaveToast({ type: 'success', text: t('bookshelf.removed') });
      setTimeout(() => setSaveToast(null), 3000);
    } catch (err: any) {
      console.error('Failed to remove book from bookshelf:', err);
      setShowRemoveConfirm(false);
      setSaveToast({ type: 'error', text: t(removeFromBookshelfErrorKey(err)) });
      setTimeout(() => setSaveToast(null), 4500);
    } finally {
      setIsSaving(false);
    }
  };

  // Open a series part. Storytel: its BookView when it is on the bookshelf,
  // otherwise the search page with the part selected in the preview pane.
  // Audioteka: its book page, which needs no library entry.
  const handleOpenSeriesBook = async (part: SearchResultBook) => {
    if (provider === 'audioteka') {
      navigate(`/book/audioteka/${part.id}`);
      return;
    }
    try {
      const res = await api.get<BookShelfResponse>('/bookshelf');
      const owned = (res.data?.books || []).find((b) => String(b.book?.consumableId) === part.id);
      if (owned) {
        navigate(`/book/${part.id}`, { state: { book: owned } });
        return;
      }
    } catch (err) {
      console.warn('Bookshelf lookup failed, opening the search preview instead', err);
    }
    navigate('/search', { state: { selectBook: part } });
  };

  const handleOpenAuthor = (author: { id?: string; name: string }) => {
    const target = catalog.authorTarget(author);
    if (target.kind === 'list') {
      navigate('/search', {
        state: { authorList: { itemsUrl: target.itemsUrl, title: target.title } },
      });
    } else {
      navigate(`/search?q=${encodeURIComponent(target.query)}`);
    }
  };

  // Recommendations are not in the library, so they open in the search preview.
  const handleOpenRecommended = (book: SearchResultBook) =>
    navigate('/search', { state: { selectBook: book } });

  const handlePlayBook = () => {
    if (stateBook) {
      navigate(`/player/${bookId}`, { state: { book: stateBook, autoPlay: true } });
      return;
    }
    if (stateEntry) {
      navigate(`/player/audioteka/${stateEntry.id}`, {
        state: { audiotekaBook: stateEntry, autoPlay: true },
      });
      return;
    }
    if (!page) return;
    const { path, state } = catalog.playTarget(page.book);
    navigate(path, { state });
  };

  if (isLoading) {
    return <LoadingState message={t('common.loading')} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={() => navigate('/')} />;
  }

  if (!display) {
    return <ErrorState error={t('common.error')} onRetry={() => navigate('/')} />;
  }

  // Saved books without a removable entry only show that they are in the library.
  const canRemove = isSaved && removable;

  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours} h ${minutes} min`;
  };

  const getTruncatedDescription = () => {
    if (!description) return t('bookView.noDescription');

    if (description.length <= 250 || showFullDescription) {
      return description;
    }

    return description.substring(0, 250) + '...';
  };

  const shouldShowMoreButton = () => {
    return description.length > 250;
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-[#FF5100] selection:text-white pb-32">
      <Navbar barTitle={t('bookView.details')} onBackClick={() => navigate('/')}>
        <span>{display.title}</span>
      </Navbar>

      {/* Toast Notification */}
      {saveToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 shadow-2xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2 bg-green-950/90 text-green-300 border border-green-700/50">
          <span>{saveToast.text}</span>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center">
          {/* Book Cover */}
          <div className="mb-6">
            <img
              src={buildCoverUrl(display.coverUrl)}
              alt={display.title}
              className="w-56 h-56 sm:w-64 sm:h-64 object-cover rounded-2xl shadow-2xl border border-white/10"
            />
          </div>

          {/* Book Title */}
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2 text-center break-words max-w-full px-4">
            {display.title}
          </h1>

          {/* Author and Narrator */}
          <div className="text-sm text-gray-300 mb-6 text-center space-y-1">
            {display.authors.length > 0 && (
              <p>
                <span className="text-gray-400">{t('bookCard.author')}</span>{' '}
                {display.authors.map((author, index) => (
                  <span key={`${author.id ?? ''}:${author.name}`}>
                    {index > 0 && <span className="font-semibold text-white">, </span>}
                    {isActiveService ? (
                      <button
                        type="button"
                        onClick={() => handleOpenAuthor(author)}
                        className="font-semibold text-white hover:underline hover:text-[#FF8A50] transition-colors"
                      >
                        {author.name}
                      </button>
                    ) : (
                      <span className="font-semibold text-white">{author.name}</span>
                    )}
                  </span>
                ))}
              </p>
            )}
            {display.narrators && (
              <p>
                <span className="text-gray-400">{t('bookCard.narrator')}</span>{' '}
                <span className="font-semibold text-white">{display.narrators}</span>
              </p>
            )}
          </div>

          {/* Action Buttons Row */}
          <div className="flex items-center gap-3 mb-8 flex-wrap justify-center">
            {/* Play Button */}
            <button
              onClick={handlePlayBook}
              className="px-7 py-3.5 bg-[#FF5100] hover:bg-[#ff641a] text-white rounded-full transition-all flex items-center gap-2 text-base font-bold shadow-lg shadow-[#FF5100]/30 hover:scale-105 active:scale-95"
            >
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>{t('bookView.listen', 'Listen')}</span>
            </button>

            {/* Save to Bookshelf Button */}
            <button
              onClick={
                canRemove
                  ? () => setShowRemoveConfirm(true)
                  : isSaved
                    ? undefined
                    : handleSaveToLibrary
              }
              disabled={isSaving || (isSaved && !canRemove)}
              title={canRemove ? t('bookshelf.remove') : undefined}
              className={`px-5 py-3.5 rounded-full transition-all flex items-center gap-2 text-sm font-semibold border group/save ${
                canRemove
                  ? 'bg-green-600/20 text-green-300 border-green-500/40 hover:bg-red-600/20 hover:text-red-300 hover:border-red-500/40'
                  : isSaved
                    ? 'bg-green-600/20 text-green-300 border-green-500/40 cursor-default'
                    : 'bg-[#1A1A1A] hover:bg-[#2C2C2E] text-white border-white/10 hover:border-white/20 active:scale-95'
              }`}
            >
              {isSaving ? (
                <div className="animate-spin w-4 h-4 text-[#FF5100]">
                  <svg fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                </div>
              ) : isSaved ? (
                <>
                  <svg
                    className={`w-4 h-4 text-green-400 ${canRemove ? 'group-hover/save:hidden' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {canRemove && (
                    <svg
                      className="w-4 h-4 hidden group-hover/save:block"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  )}
                </>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              )}
              <span className={canRemove ? 'group-hover/save:hidden' : undefined}>
                {isSaved ? t('bookView.inLibrary') : t('bookView.addToLibrary')}
              </span>
              {canRemove && (
                <span className="hidden group-hover/save:inline">{t('bookshelf.remove')}</span>
              )}
            </button>
          </div>

          {/* Book Info */}
          <div className="w-full max-w-md space-y-2 text-sm">
            <div className="flex justify-between py-2 border-b border-gray-800">
              <span className="text-gray-400">{t('bookView.language')}</span>
              <span className="text-white">{language}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-800">
              <span className="text-gray-400">{t('bookView.duration')}</span>
              <span className="text-white">{formatDuration(display.durationMs)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-800">
              <span className="text-gray-400">{t('bookView.category')}</span>
              <span className="text-white flex items-center">{display.category}</span>
            </div>
          </div>

          {seriesInfo && (
            <div className="w-full max-w-md mt-8">
              <SeriesHint
                seriesInfo={seriesInfo}
                currentBookId={display.id}
                finished={finished}
                onOpenBook={handleOpenSeriesBook}
                // The route's service, whichever is active.
                catalog={catalog}
              />
            </div>
          )}

          {/* Description */}
          <div className="w-full max-w-md mt-8">
            <p className="text-gray-300 text-sm leading-relaxed">{getTruncatedDescription()}</p>
            {shouldShowMoreButton() && (
              <button
                onClick={() => setShowFullDescription(!showFullDescription)}
                className="text-white mt-2 text-sm font-semibold hover:text-gray-300 transition-colors"
              >
                ...{showFullDescription ? t('bookView.showLess') : t('bookView.showMore')}
              </button>
            )}
          </div>

          {isActiveService && page && page.recommendedAfter.length > 0 && (
            <section className="w-full max-w-md mt-8" aria-label={t('bookView.recommendedAfter')}>
              <h2 className="text-sm font-bold text-white mb-2">
                {t('bookView.recommendedAfter')}
              </h2>
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {page.recommendedAfter.map((book) => (
                  <DiscoverCard
                    key={book.id}
                    book={book}
                    selected={false}
                    onSelect={handleOpenRecommended}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      <ConfirmRemoveBookModal
        isOpen={showRemoveConfirm}
        bookTitle={display.title}
        isRemoving={isSaving}
        onConfirm={handleRemoveFromLibrary}
        onCancel={() => setShowRemoveConfirm(false)}
      />
    </div>
  );
}

// Keyed by book so opening another part from the series list resets all state.
function BookView({ provider }: BookViewProps) {
  const { bookId } = useParams();
  const { active } = useProviders();
  // Only the active service's books are shown: a book page left open across a
  // switch in Settings must not keep playing or saving through the other service.
  if (isOtherServiceRoute(provider, active)) return <Navigate to="/" replace />;
  return <BookViewContent key={`${provider}:${bookId}`} provider={provider} />;
}

export default BookView;
