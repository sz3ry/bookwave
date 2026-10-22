// Maps each provider's library into LibraryBook and merges them into one list.
import type { BookShelfEntity } from '../interfaces/books';
import type { AudiotekaLibraryEntry, LibraryBook, ProviderId } from '../interfaces/library';
import { buildCoverUrl } from './helpers';
import storage from './storage';

// Share of the duration from which a book counts as concluded.
const CONCLUDED_RATIO = 0.98;

/** Storytel status 1/2/3 plus position, as the Dashboard filters always derived it. */
const shelfStatus = (e: BookShelfEntity): LibraryBook['status'] => {
  const s = +e.status;
  const pos = e.abookMark?.pos || 0;
  if (s === 3) return 'concluded';
  if (s === 2 || pos > 0) return 'started';
  return 'notStarted';
};

/** Storytel shelf entity; Storytel times are microseconds. */
export function fromShelfEntity(e: BookShelfEntity): LibraryBook {
  const cover =
    e.book?.largeCover ||
    e.book?.largeCoverE ||
    e.book?.cover ||
    e.book?.coverE ||
    e.book?.smallCover;
  return {
    provider: 'storytel',
    key: `storytel:${e.abook?.id || e.id}`,
    title: e.book?.name || '',
    authors: e.book?.authorsAsString || '',
    coverUrl: buildCoverUrl(cover) || null,
    durationMs: (e.abook?.time || 0) / 1000,
    positionMs: (e.abookMark?.pos || 0) / 1000,
    status: shelfStatus(e),
    // The same fields compareByRecency ranks by.
    lastActivity: e.positionUpdatedTime || e.stateUpdateTime || null,
    available: true,
    storytel: e,
  };
}

/** Audioteka library entry; a position saved on this device wins over the remote one. */
export function fromAudiotekaEntry(
  e: AudiotekaLibraryEntry,
  local: { position: number; updatedAt: string } | null,
): LibraryBook {
  const positionMs = local ? local.position : (e.positionMs ?? 0);
  const status: LibraryBook['status'] =
    positionMs <= 0
      ? 'notStarted'
      : e.durationMs > 0 && positionMs >= e.durationMs * CONCLUDED_RATIO
        ? 'concluded'
        : 'started';
  return {
    provider: 'audioteka',
    key: `audioteka:${e.id}`,
    title: e.title,
    authors: e.authors.join(', '),
    coverUrl: e.coverUrl,
    durationMs: e.durationMs,
    positionMs,
    status,
    lastActivity: local?.updatedAt ?? null,
    available: e.available,
    audioteka: e,
  };
}

const activityTime = (b: LibraryBook): number | null => {
  if (!b.lastActivity) return null;
  const t = new Date(b.lastActivity).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Newest activity first, books without activity last, then by title. */
const compareBooks = (a: LibraryBook, b: LibraryBook): number => {
  const ta = activityTime(a);
  const tb = activityTime(b);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  return a.title.localeCompare(b.title);
};

/**
 * Merges the providers' libraries. `null` means the provider is not logged in;
 * a rejected provider contributes no books and is listed in `failed`.
 */
export function combineLibraries(
  storytel: PromiseSettledResult<LibraryBook[]> | null,
  audioteka: PromiseSettledResult<LibraryBook[]> | null,
): { books: LibraryBook[]; failed: ProviderId[] } {
  const books: LibraryBook[] = [];
  const failed: ProviderId[] = [];
  const sources: [ProviderId, PromiseSettledResult<LibraryBook[]> | null][] = [
    ['storytel', storytel],
    ['audioteka', audioteka],
  ];
  for (const [provider, result] of sources) {
    if (!result) continue;
    if (result.status === 'fulfilled') books.push(...result.value);
    else failed.push(provider);
  }
  books.sort(compareBooks);
  return { books, failed };
}

/** Position saved on this device for an Audioteka book (`pos:audioteka:<id>`), if any. */
export async function readAudiotekaLocalPosition(
  audiobookId: string,
): Promise<{ position: number; updatedAt: string } | null> {
  try {
    const raw = await storage.get(`pos:audioteka:${audiobookId}`);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (typeof parsed?.position === 'number' && typeof parsed?.updatedAt === 'string') {
      return { position: parsed.position, updatedAt: parsed.updatedAt };
    }
    return null;
  } catch {
    return null;
  }
}
