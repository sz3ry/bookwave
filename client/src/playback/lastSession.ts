import type { AudiotekaLibraryEntry } from '../interfaces/library';

/**
 * `last_played_session` (restored on launch) holds the last book that was
 * loaded, in one of two shapes:
 * - Storytel: `{ book, bookId, consumableId }` (the original, untagged shape);
 * - Audioteka: `{ provider: 'audioteka', entry }`, the library entry only
 *   (display fields and the audiobook id; no token, refresh id or device id).
 * An Audioteka id in the Storytel shape (written by earlier builds) matches
 * neither: restoring it would call Storytel endpoints with it.
 */
export interface StorytelSession {
  book?: unknown;
  bookId: string;
  consumableId?: string;
}

export interface AudiotekaSession {
  provider: 'audioteka';
  entry: AudiotekaLibraryEntry;
}

// Same shape the server accepts as an Audioteka id.
const AUDIOTEKA_ID = /^[0-9a-f-]{36}$/i;

const LIBRARY_SOURCES: readonly unknown[] = ['recent', 'favourite', 'shelf'];

const isStorytelId = (value: unknown): boolean =>
  (typeof value === 'string' && value !== '' && !AUDIOTEKA_ID.test(value)) ||
  (typeof value === 'number' && Number.isFinite(value));

const isStringArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export function isStorytelSession(saved: unknown): saved is StorytelSession {
  if (typeof saved !== 'object' || saved === null) return false;
  const entry = saved as Record<string, unknown>;
  if (entry.provider !== undefined && entry.provider !== 'storytel') return false;
  if (!isStorytelId(entry.bookId)) return false;
  return entry.consumableId == null || isStorytelId(entry.consumableId);
}

const isAudiotekaEntry = (value: unknown): value is AudiotekaLibraryEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    AUDIOTEKA_ID.test(entry.id) &&
    typeof entry.title === 'string' &&
    isStringArray(entry.authors) &&
    isStringArray(entry.narrators) &&
    (entry.coverUrl === null || typeof entry.coverUrl === 'string') &&
    typeof entry.durationMs === 'number' &&
    Number.isFinite(entry.durationMs) &&
    entry.durationMs >= 0 &&
    Array.isArray(entry.sources) &&
    entry.sources.every((source) => LIBRARY_SOURCES.includes(source)) &&
    typeof entry.available === 'boolean' &&
    (entry.positionMs === null ||
      (typeof entry.positionMs === 'number' && Number.isFinite(entry.positionMs)))
  );
};

export function isAudiotekaSession(saved: unknown): saved is AudiotekaSession {
  if (typeof saved !== 'object' || saved === null) return false;
  const session = saved as Record<string, unknown>;
  return session.provider === 'audioteka' && isAudiotekaEntry(session.entry);
}
