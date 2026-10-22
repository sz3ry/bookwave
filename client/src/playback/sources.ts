import api from '../utils/api';
import type { BookShelfEntity } from '../interfaces/books';
import type { BookmarkPositional } from '../interfaces/bookmarks';
import type { Chapter } from '../interfaces/chapters';
import type { ProviderId } from '../interfaces/library';
import { extractChaptersFromResponse, generateAudioTracks } from '../utils/chapters';
import type { TimelineTrack } from './timeline';

/**
 * Everything the audio context needs to play one book of one provider. The
 * context owns the `<audio>` element and the book timeline; a source only
 * answers provider questions (where a track streams from, where the position
 * is stored, which chapters exist).
 */
export interface PlaybackSource {
  provider: ProviderId;
  /** Identifies the book within its provider. */
  bookKey: string;
  /** Key of the local position cache (`StoredPosition`) in the app store. */
  positionStorageKey: string;
  /**
   * The book timeline. A single-track source plays the whole book from one
   * element, so its track duration may stay 0 until the metadata has loaded.
   */
  tracks: TimelineTrack[];
  resolveTrackUrl(index: number): Promise<{ url: string; remote: boolean }>;
  /** Resolves to null when the provider has no position; rejects when it cannot be asked. */
  readRemotePosition(): Promise<{
    positionMs: number;
    device: string | null;
    updatedTime?: string;
  } | null>;
  writeRemotePosition(positionMs: number): Promise<void>;
  remoteWriteIntervalMs: number;
  /** `newest`: the newer of local and remote wins. `ask`: see `resolveStartPosition`. */
  conflictPolicy: 'newest' | 'ask';
  /** `durationSeconds` is the book duration when known, otherwise 0. */
  loadChapters(durationSeconds: number): Promise<Chapter[]>;
  onPlaybackStarted?(): void;
}

/**
 * A Storytel book: one stream for the whole book, positions under
 * `pos:<consumableId>` and `/bookmark-positional`. `book` must already be the
 * entry matching `bookId` (or null).
 */
export function createStorytelSource(book: BookShelfEntity | null, bookId: string): PlaybackSource {
  const consumableId = book?.book?.consumableId || bookId;

  return {
    provider: 'storytel',
    bookKey: consumableId,
    positionStorageKey: `pos:${consumableId}`,
    tracks: [{ id: consumableId, startMs: 0, durationMs: 0 }],

    async resolveTrackUrl() {
      const response = await api.post('/stream', { bookId, consumableId });
      return { url: response.data.streamUrl, remote: Boolean(response.data.remote) };
    },

    async readRemotePosition() {
      const response = await api.get<BookmarkPositional[]>(`/bookmark-positional/${consumableId}`);
      const entry = response.data?.find((format) => format.type === 'abook');
      if (!entry) return null;
      return {
        positionMs: entry.position || 0,
        device: null,
        updatedTime: entry.updatedTime || undefined,
      };
    },

    async writeRemotePosition(positionMs) {
      await api.put(`/bookmark-positional/${consumableId}`, { position: positionMs });
    },

    remoteWriteIntervalMs: 15000,
    conflictPolicy: 'newest',

    async loadChapters(durationSeconds) {
      try {
        const response = await api.get(`/bookmetadata/${consumableId}`);
        const list = extractChaptersFromResponse(response.data);
        if (list.length > 0) return list;
      } catch (err) {
        console.warn('Failed to load chapters from /bookmetadata:', err);
      }

      try {
        const details = await api.get(`/book-details/${consumableId}`);
        const list = extractChaptersFromResponse(details.data);
        if (list.length > 0) return list;
      } catch (err) {
        console.warn('Failed to load chapters from /book-details:', err);
      }

      // Fallback: if the duration is known, generate structured audio tracks ("Ljudspår")
      return durationSeconds > 0 ? generateAudioTracks(durationSeconds) : [];
    },
  };
}
