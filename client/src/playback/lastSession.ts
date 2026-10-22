/**
 * `last_played_session` (restored on launch) only ever holds a Storytel book:
 * `{ book, bookId, consumableId }`. An Audioteka book id there (written by
 * earlier builds) would make the restore call Storytel endpoints with it.
 */
export interface StorytelSession {
  book?: unknown;
  bookId: string;
  consumableId?: string;
}

// Same shape the server accepts as an Audioteka id.
const AUDIOTEKA_ID = /^[0-9a-f-]{36}$/i;

const isStorytelId = (value: unknown): boolean =>
  (typeof value === 'string' && value !== '' && !AUDIOTEKA_ID.test(value)) ||
  (typeof value === 'number' && Number.isFinite(value));

export function isStorytelSession(saved: unknown): saved is StorytelSession {
  if (typeof saved !== 'object' || saved === null) return false;
  const entry = saved as Record<string, unknown>;
  if (entry.provider !== undefined && entry.provider !== 'storytel') return false;
  if (!isStorytelId(entry.bookId)) return false;
  return entry.consumableId == null || isStorytelId(entry.consumableId);
}
