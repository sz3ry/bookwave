// One library across services: the Dashboard works on LibraryBook only.
import type { BookShelfEntity } from './books';

export type ProviderId = 'storytel' | 'audioteka';

export type LibrarySource = 'recent' | 'favourite' | 'shelf';

/** Client copy of the server's `AudiotekaLibraryEntry` (`GET /api/audioteka/library`). */
export interface AudiotekaLibraryEntry {
  id: string;
  title: string;
  authors: string[];
  narrators: string[];
  coverUrl: string | null;
  durationMs: number;
  sources: LibrarySource[];
  available: boolean;
  positionMs: number | null;
}

/** Client copy of the server's `AudiotekaTrack`: one MP3 on the book timeline. */
export interface AudiotekaTrack {
  id: string;
  index: number;
  durationMs: number;
  startMs: number;
}

/** `GET /api/audioteka/books/:id`. */
export interface AudiotekaBookDetails {
  book: Omit<AudiotekaLibraryEntry, 'sources' | 'available' | 'positionMs'>;
  tracks: AudiotekaTrack[];
}

export interface LibraryBook {
  provider: ProviderId;
  /** `storytel:<abook.id || id>` or `audioteka:<id>`; unique across providers. */
  key: string;
  title: string;
  authors: string;
  /** Absolute URL, or null when the book has no cover. */
  coverUrl: string | null;
  durationMs: number;
  positionMs: number;
  status: 'notStarted' | 'started' | 'concluded';
  /** ISO timestamp the library is ordered by, newest first. */
  lastActivity: string | null;
  available: boolean;
  storytel?: BookShelfEntity;
  audioteka?: AudiotekaLibraryEntry;
}
