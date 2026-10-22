import api from '../utils/api';
import i18n from '../i18n';
import type { BookShelfEntity } from '../interfaces/books';
import type { BookmarkPositional } from '../interfaces/bookmarks';
import type { Chapter } from '../interfaces/chapters';
import type {
  AudiotekaBookDetails,
  AudiotekaLibraryEntry,
  AudiotekaTrack,
  ProviderId,
} from '../interfaces/library';
import { extractChaptersFromResponse, generateAudioTracks } from '../utils/chapters';
import { createTrackUrlCache, type TimelineTrack } from './timeline';

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
  /**
   * Forgets a cached URL of track `index` (the CDN refused it), so the next
   * `resolveTrackUrl` asks the provider again. Only sources that cache URLs have it.
   */
  invalidateTrackUrl?(index: number): void;
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

/** `GET /api/audioteka/books/:id`: the book and its track timeline. */
export async function fetchAudiotekaBook(id: string): Promise<AudiotekaBookDetails> {
  const response = await api.get<AudiotekaBookDetails>(
    `/audioteka/books/${encodeURIComponent(id)}`,
  );
  return response.data;
}

type RemotePosition = Awaited<ReturnType<PlaybackSource['readRemotePosition']>>;

/** `GET /api/audioteka/positions/:id`; null when the account has no position for the book. */
export async function fetchAudiotekaPosition(id: string): Promise<RemotePosition> {
  const response = await api.get<{ positionMs: number; device: string | null } | null>(
    `/audioteka/positions/${encodeURIComponent(id)}`,
  );
  return response.data ?? null;
}

/**
 * An Audioteka book: many MP3 tracks played as one continuous timeline,
 * positions under `pos:audioteka:<id>` (ms) and the account's playback
 * progress. Signed track URLs are cached until shortly before they expire.
 */
export function createAudiotekaSource(
  entry: AudiotekaLibraryEntry,
  tracks: AudiotekaTrack[],
  now: () => number = Date.now,
): PlaybackSource {
  const id = entry.id;
  const ordered = [...tracks].sort((a, b) => a.index - b.index);
  const timeline: TimelineTrack[] = ordered.map((track) => ({
    id: track.id,
    startMs: track.startMs,
    durationMs: track.durationMs,
  }));
  const urls = createTrackUrlCache(now);
  // One request per track at a time: a prefetch and a resolve can overlap.
  const inFlight = new Map<string, Promise<string>>();
  let startReported = false;

  const trackUrl = (index: number): Promise<string> => {
    const track = timeline[index];
    if (!track) return Promise.reject(new Error(`Track ${index} is not on the timeline`));
    const cached = urls.get(track.id);
    if (cached) return Promise.resolve(cached);
    const running = inFlight.get(track.id);
    if (running) return running;
    const request = api
      .get<{ url: string; expiresAt: number }>(
        `/audioteka/tracks/${encodeURIComponent(track.id)}/url`,
      )
      .then((response) => {
        urls.set(track.id, response.data.url, response.data.expiresAt);
        return response.data.url;
      })
      .finally(() => inFlight.delete(track.id));
    inFlight.set(track.id, request);
    return request;
  };

  return {
    provider: 'audioteka',
    bookKey: id,
    positionStorageKey: `pos:audioteka:${id}`,
    tracks: timeline,

    async resolveTrackUrl(index) {
      const url = await trackUrl(index);
      // The next track is likely asked for when this one ends
      if (index + 1 < timeline.length) {
        trackUrl(index + 1).catch((err) => {
          console.warn('Failed to prefetch the next track URL:', err);
        });
      }
      return { url, remote: true };
    },

    invalidateTrackUrl(index) {
      const track = timeline[index];
      if (track) urls.invalidate(track.id);
    },

    readRemotePosition: () => fetchAudiotekaPosition(id),

    async writeRemotePosition(positionMs) {
      await api.put(`/audioteka/positions/${encodeURIComponent(id)}`, { position: positionMs });
    },

    remoteWriteIntervalMs: 60000,
    conflictPolicy: 'ask',

    async loadChapters() {
      return timeline.map((track, index) => ({
        number: index + 1,
        title: i18n.t('player.part', { n: index + 1 }),
        start: track.startMs / 1000,
        end: (track.startMs + track.durationMs) / 1000,
        durationInSeconds: track.durationMs / 1000,
      }));
    },

    onPlaybackStarted() {
      if (startReported) return;
      startReported = true;
      api.post(`/audioteka/books/${encodeURIComponent(id)}/start`).catch((err) => {
        console.warn('Failed to report the Audioteka playback start:', err);
      });
    },
  };
}
