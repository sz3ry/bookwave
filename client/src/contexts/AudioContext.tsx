import type React from 'react';
import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { trackAction } from '../utils/api';
import storage from '../utils/storage';
import type { BookShelfEntity } from '../interfaces/books';
import type { Chapter } from '../interfaces/chapters';
import type { AudiotekaLibraryEntry, ProviderId } from '../interfaces/library';
import { generateAudioTracks } from '../utils/chapters';
import { audiotekaEntryToBookEntity } from '../utils/helpers';
import i18n from '../i18n';
import {
  createAudiotekaSource,
  createStorytelSource,
  fetchAudiotekaBook,
  type PlaybackSource,
} from '../playback/sources';
import { isStorytelSession } from '../playback/lastSession';
import PositionConflictModal, { type PositionConflict } from '../components/PositionConflictModal';
import { totalDurationMs } from '../playback/timeline';
import {
  bookPositionMs,
  bookSeconds as timelineSeconds,
  nextTrackIndex,
  nextUrlRetry,
  planSeek,
  type UrlRetries,
} from '../playback/trackNavigation';
import {
  resolveStartPosition,
  shouldRecheckRemote,
  type StoredPosition,
  storedPosition,
} from '../playback/positionSync';

const readLocalPosition = async (storageKey: string): Promise<StoredPosition | null> => {
  try {
    const raw = await storage.get(storageKey);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (typeof parsed?.position === 'number' && typeof parsed?.updatedAt === 'string') {
      return parsed as StoredPosition;
    }
    return null;
  } catch {
    return null;
  }
};

// `remoteSeen` is kept only for sources with the `ask` conflict policy.
const writeLocalPosition = async (storageKey: string, position: number, remoteSeen?: number) => {
  try {
    const payload = storedPosition(position, remoteSeen);
    await storage.set(storageKey, JSON.stringify(payload));
  } catch {
    // best-effort cache; ignore failures
  }
};

// Local positions are written at this pace while playing; a source's remote
// writes happen on every n-th of these ticks (`remoteWriteIntervalMs`).
const LOCAL_POSITION_INTERVAL_MS = 15000;

// A track whose URL the element rejects (a signed CDN URL expired or answered
// 403) is re-resolved at most this many times within the window, then the
// load error is shown.
const URL_RETRY_LIMIT = 2;
const URL_RETRY_WINDOW_MS = 10_000;

// Resuming a paused `ask` book asks the provider for its position again (the
// phone may have moved it), at most this often, and stops waiting for the
// answer after the timeout: local playback never depends on the provider.
const REMOTE_RECHECK_INTERVAL_MS = 10_000;
const REMOTE_RECHECK_TIMEOUT_MS = 5000;

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No answer within ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });

/** Current position on the book timeline, in seconds (see `trackNavigation`). */
const bookSeconds = (
  audio: HTMLAudioElement,
  source: PlaybackSource | null,
  trackIndex: number,
): number =>
  source ? timelineSeconds(source.tracks, trackIndex, audio.currentTime) : audio.currentTime;

/** `newest` policy: the newer of the local cache and the provider's position, in ms. */
const newestStartPosition = (
  local: StoredPosition | null,
  remote: Awaited<ReturnType<PlaybackSource['readRemotePosition']>>,
): number => {
  if (remote && local) {
    const remoteTime = remote.updatedTime ? Date.parse(remote.updatedTime) : 0;
    const localTime = Date.parse(local.updatedAt);
    return localTime > remoteTime ? local.position : remote.positionMs;
  }
  if (remote) return remote.positionMs;
  if (local) return local.position;
  return 0;
};

const errorMessage = (err: any): string =>
  err.response?.data?.error || err.message || i18n.t('player.loadError');

export interface CurrentChapterInfo {
  number: number;
  title: string;
  start: number;
  end: number;
  durationInSeconds?: number;
}

export interface AudioContextType {
  /** The playing book's display fields; for an Audioteka book see `activeAudiotekaEntry`. */
  activeBook: BookShelfEntity | null;
  activeProvider: ProviderId | null;
  activeAudiotekaEntry: AudiotekaLibraryEntry | null;
  activeBookId: string | null;
  activeConsumableId: string | null;
  audioSrc: string | null;
  isLoading: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  chapters: Chapter[];
  currentChapter: CurrentChapterInfo | null;
  loadBook: (book: BookShelfEntity | null, bookId: string, autoPlay?: boolean) => Promise<void>;
  loadAudiotekaBook: (entry: AudiotekaLibraryEntry, autoPlay?: boolean) => Promise<void>;
  togglePlayPause: () => void;
  seek: (seekTime: number) => void;
  skipForward: (seconds?: number) => void;
  skipBackward: (seconds?: number) => void;
  setRate: (rate: number) => void;
  cyclePlaybackRate: () => void;
  setVolume: (newVolume: number) => void;
  toggleMute: () => void;
  jumpToChapter: (startTime: number) => void;
  sleepTimerRemaining: number | null;
  sleepTimerMode: number | 'chapter' | null;
  setSleepTimer: (option: number | 'chapter' | null) => void;
  error: string | null;
  setError: (err: string | null) => void;
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);

const PLAYBACK_RATES = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const positionUpdateIntervalRef = useRef<any>(null);
  const sleepTimerIntervalRef = useRef<any>(null);

  const [activeBook, setActiveBook] = useState<BookShelfEntity | null>(null);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [activeConsumableId, setActiveConsumableId] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<PlaybackSource | null>(null);
  const [activeProvider, setActiveProvider] = useState<ProviderId | null>(null);
  const [activeAudiotekaEntry, setActiveAudiotekaEntry] = useState<AudiotekaLibraryEntry | null>(
    null,
  );
  const [positionConflict, setPositionConflict] = useState<PositionConflict | null>(null);

  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolumeState] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(1.0);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState<number | null>(null);
  const [sleepTimerMode, setSleepTimerMode] = useState<number | 'chapter' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `loadBook` is handed to components that list it in effect dependencies, so
  // it has to keep a stable identity across renders. It therefore reads the live
  // playback state through these mirrors instead of closing over the state.
  const activeBookIdRef = useRef<string | null>(null);
  const audioSrcRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);
  // The source the `<audio>` element plays, and the track of it that is loaded.
  const sourceRef = useRef<PlaybackSource | null>(null);
  const trackIndexRef = useRef(0);
  // Set while the element switches to another track of the same book (from
  // the URL request until the new track's metadata has loaded): the track,
  // the offset to start it at, and whether it plays then. Element pause/time
  // events of the old track are not the book's while it is set.
  const pendingTrackStartRef = useRef<{
    index: number;
    offsetSeconds: number;
    play: boolean;
  } | null>(null);
  // Whether the loaded track streams from the network (see `resolveTrackUrl`).
  const trackRemoteRef = useRef(false);
  // True from a book load until its first track's metadata has applied the
  // saved position.
  const awaitingStartPositionRef = useRef(false);
  // Recent URL re-resolves of one track, for `URL_RETRY_LIMIT`.
  const urlRetriesRef = useRef<UrlRetries>({ index: -1, at: [] });
  // The last remote position Bookwave saw or wrote for the active book, kept
  // in its local position (`StoredPosition.remoteSeen`); `ask` sources only.
  const remoteSeenRef = useRef<number | undefined>(undefined);
  // Settles the open position conflict prompt; null settles it without a choice.
  const conflictResolverRef = useRef<((choice: 'local' | 'remote' | null) => void) | null>(null);
  // The Audioteka book whose details are being fetched by `loadAudiotekaBook`.
  const audiotekaLoadingIdRef = useRef<string | null>(null);
  const activeAudiotekaEntryRef = useRef<AudiotekaLibraryEntry | null>(null);
  // When the provider's position of a book was last read (start or resume)
  const lastRemoteCheckRef = useRef<{ source: PlaybackSource | null; at: number }>({
    source: null,
    at: 0,
  });
  // A resume re-check in flight; a play request during it is remembered here
  const remoteRecheckRef = useRef<{ wantsPlay: boolean } | null>(null);
  // The latest `markPaused`, for callbacks that keep a stable identity.
  const markPausedRef = useRef<(writePosition?: boolean) => void>(() => {});
  // Discards a slow stream/track URL response once a newer load has taken over.
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    activeBookIdRef.current = activeBookId;
    audioSrcRef.current = audioSrc;
    isPlayingRef.current = isPlaying;
    activeAudiotekaEntryRef.current = activeAudiotekaEntry;
  });

  const remoteSeenFor = useCallback(
    (source: PlaybackSource): number | undefined =>
      source.conflictPolicy === 'ask' && sourceRef.current === source
        ? remoteSeenRef.current
        : undefined,
    [],
  );

  // The book position in ms to save, honouring a pending track switch
  const positionToSave = useCallback(
    (audio: HTMLAudioElement, source: PlaybackSource): number =>
      bookPositionMs(
        source.tracks,
        trackIndexRef.current,
        audio.currentTime,
        pendingTrackStartRef.current,
      ),
    [],
  );

  // Remote write of the active (or just replaced) book; on success the local
  // position records the written value as seen.
  const writeRemote = useCallback(async (source: PlaybackSource, position: number) => {
    await source.writeRemotePosition(position);
    if (source.conflictPolicy !== 'ask') return;
    if (sourceRef.current === source) remoteSeenRef.current = position;
    await writeLocalPosition(source.positionStorageKey, position, position);
  }, []);

  // Position synchronization helper
  const updatePosition = useCallback(
    async (shouldWriteRemote: boolean = true) => {
      if (!audioRef.current || !activeSource) return;
      // A torn-down element (a book switch pauses it after removing its
      // stream) reads 0, which is not the book's position
      if (!audioSrcRef.current) return;

      const position = positionToSave(audioRef.current, activeSource);
      // Always persist locally first so offline listening is preserved
      await writeLocalPosition(
        activeSource.positionStorageKey,
        position,
        remoteSeenFor(activeSource),
      );
      if (!shouldWriteRemote) return;

      try {
        await writeRemote(activeSource, position);
      } catch (err) {
        console.warn('Failed to sync position to API, kept locally', err);
      }
    },
    [activeSource, writeRemote, remoteSeenFor, positionToSave],
  );

  // Switch the element to another track of the current book. `start` null
  // reloads a track that has not applied the book's saved position yet, which
  // its metadata then does as on a fresh load.
  const loadTrack = useCallback(
    async (
      source: PlaybackSource,
      index: number,
      start: { offsetSeconds: number; play: boolean } | null,
    ) => {
      const audio = audioRef.current;
      if (!audio) return;
      const requestId = ++loadRequestIdRef.current;
      pendingTrackStartRef.current = start ? { index, ...start } : null;
      try {
        const { url, remote } = await source.resolveTrackUrl(index);
        if (requestId !== loadRequestIdRef.current) return;

        trackIndexRef.current = index;
        trackRemoteRef.current = remote;
        audioSrcRef.current = url;
        setAudioSrc(url);
        audio.src = url;
        audio.load();
      } catch (err) {
        if (requestId !== loadRequestIdRef.current) return;
        console.error('Failed to load audio track:', err);
        // The element still holds the previous track, which stays current
        pendingTrackStartRef.current = null;
        setError(errorMessage(err));
        setIsLoading(false);
        if (audio.paused) {
          markPausedRef.current();
        } else {
          audio.pause();
        }
      }
    },
    [],
  );

  // Move to a book position in seconds. Returns true when that needs another
  // track, which then starts asynchronously (and plays when `play` is set).
  const seekBook = useCallback(
    (seconds: number, play?: boolean): boolean => {
      const audio = audioRef.current;
      if (!audio) return false;
      const source = sourceRef.current;
      if (!source) {
        audio.currentTime = seconds;
        return false;
      }
      // While a switch is pending the loaded track is on its way out, so any
      // target needs a (new) track load
      const pending = pendingTrackStartRef.current;
      const plan = planSeek(source.tracks, pending ? -1 : trackIndexRef.current, seconds);
      if (plan.kind === 'element') {
        audio.currentTime = plan.seconds;
        return false;
      }
      loadTrack(source, plan.index, {
        offsetSeconds: plan.offsetSeconds,
        play: play ?? (pending ? pending.play : !audio.paused),
      });
      return true;
    },
    [loadTrack],
  );

  // Opens the position conflict prompt and resolves with the user's choice,
  // or with null when another book load closes it first.
  const askPositionConflict = useCallback(
    (conflict: PositionConflict) =>
      new Promise<'local' | 'remote' | null>((resolve) => {
        conflictResolverRef.current?.(null);
        conflictResolverRef.current = resolve;
        setPositionConflict(conflict);
      }),
    [],
  );

  const settlePositionConflict = useCallback((choice: 'local' | 'remote' | null) => {
    const resolve = conflictResolverRef.current;
    conflictResolverRef.current = null;
    setPositionConflict(null);
    resolve?.(choice);
  }, []);

  // Pause and resume that respect a pending track switch: the old track must
  // neither restart nor hand its pause to the book, so the switch's own play
  // flag decides what the new track does once it has loaded.
  const pausePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const pending = pendingTrackStartRef.current;
    if (pending) {
      if (!pending.play) return;
      pending.play = false;
      if (!audio.paused) audio.pause();
      markPausedRef.current();
      return;
    }
    audio.pause();
  }, []);

  const resumePlayback = useCallback(() => {
    const audio = audioRef.current;
    // While the conflict prompt is open the start position is not applied yet
    if (!audio || conflictResolverRef.current) return;
    const pending = pendingTrackStartRef.current;
    if (pending) {
      pending.play = true;
      setIsPlaying(true);
      return;
    }
    audio.play().catch(console.error);
  }, []);

  // Read remote/local saved position and jump. Returns true when the position
  // is on another track, which then starts asynchronously.
  const goToPosition = useCallback(
    async (source: PlaybackSource, play: boolean): Promise<boolean> => {
      let remote: Awaited<ReturnType<PlaybackSource['readRemotePosition']>> = null;
      try {
        remote = await source.readRemotePosition();
      } catch (err) {
        console.warn('Failed to fetch remote position, will use local cache', err);
      }
      lastRemoteCheckRef.current = { source, at: Date.now() };

      const local = await readLocalPosition(source.positionStorageKey);
      let chosenPosition: number;
      if (source.conflictPolicy === 'ask') {
        const start = resolveStartPosition(local, remote);
        if (sourceRef.current !== source) return false;
        if (start.kind === 'use') {
          chosenPosition = start.positionMs;
          remoteSeenRef.current = remote?.positionMs ?? local?.remoteSeen;
        } else {
          const choice = await askPositionConflict({
            localMs: start.localMs,
            remoteMs: start.remoteMs,
            device: start.device,
          });
          if (choice === null || sourceRef.current !== source) return false;
          chosenPosition = choice === 'remote' ? start.remoteMs : start.localMs;
          remoteSeenRef.current = start.remoteMs;
          await writeLocalPosition(source.positionStorageKey, chosenPosition, start.remoteMs);
        }
      } else {
        chosenPosition = newestStartPosition(local, remote);
      }

      if (sourceRef.current !== source || !audioRef.current) return false;
      const switched = seekBook(Math.floor(chosenPosition / 1000), play);
      if (!switched) {
        setCurrentTime(bookSeconds(audioRef.current, source, trackIndexRef.current));
      }
      return switched;
    },
    [seekBook, askPositionConflict],
  );

  // Resumes a paused book (`play`) or just re-validates the active one. For an
  // `ask` source the provider's position is read again first: another device
  // may have moved it while Bookwave was paused. A move beyond the threshold
  // opens the conflict prompt before playing; a failed or slow read plays on
  // from this device's position.
  const resumeWithRemoteCheck = useCallback(
    async (play: boolean) => {
      const audio = audioRef.current;
      const source = sourceRef.current;
      if (!audio || !source || conflictResolverRef.current) return;
      const running = remoteRecheckRef.current;
      if (running) {
        running.wantsPlay ||= play;
        return;
      }
      const last = lastRemoteCheckRef.current;
      const recheck = shouldRecheckRemote({
        policy: source.conflictPolicy,
        switching: pendingTrackStartRef.current !== null,
        awaitingStart: awaitingStartPositionRef.current,
        lastCheckAt: last.source === source ? last.at : null,
        now: Date.now(),
        minIntervalMs: REMOTE_RECHECK_INTERVAL_MS,
      });
      if (!recheck) {
        if (play) resumePlayback();
        return;
      }

      const check = { wantsPlay: play };
      remoteRecheckRef.current = check;
      lastRemoteCheckRef.current = { source, at: Date.now() };
      try {
        let remote: Awaited<ReturnType<PlaybackSource['readRemotePosition']>> = null;
        try {
          remote = await withTimeout(source.readRemotePosition(), REMOTE_RECHECK_TIMEOUT_MS);
        } catch (err) {
          console.warn('Failed to re-check the remote position, playing on locally', err);
        }
        if (sourceRef.current !== source) return;

        if (remote && !pendingTrackStartRef.current) {
          const currentMs = positionToSave(audio, source);
          const decision = resolveStartPosition(
            storedPosition(currentMs, remoteSeenRef.current),
            remote,
          );
          if (decision.kind === 'use') {
            remoteSeenRef.current = remote.positionMs;
          } else {
            const choice = await askPositionConflict({
              localMs: decision.localMs,
              remoteMs: decision.remoteMs,
              device: decision.device,
            });
            if (choice === null || sourceRef.current !== source) return;
            const chosenMs = choice === 'remote' ? decision.remoteMs : decision.localMs;
            remoteSeenRef.current = decision.remoteMs;
            await writeLocalPosition(source.positionStorageKey, chosenMs, decision.remoteMs);
            if (sourceRef.current !== source) return;
            if (choice === 'remote') {
              const seconds = chosenMs / 1000;
              setCurrentTime(seconds);
              // Another track starts (and plays) on its own
              if (seekBook(seconds, check.wantsPlay)) return;
            }
          }
        }
        if (check.wantsPlay) resumePlayback();
      } finally {
        if (remoteRecheckRef.current === check) remoteRecheckRef.current = null;
      }
    },
    [askPositionConflict, positionToSave, resumePlayback, seekBook],
  );

  // Load chapters for the active book
  const refreshChapters = useCallback(
    async (source: PlaybackSource, knownDurationSeconds: number) => {
      const list = await source.loadChapters(knownDurationSeconds);
      // A newer book took over while the chapters were loading
      if (sourceRef.current !== source) return;

      // Single-track fallback: the stream may know the duration by now
      const elementDuration = audioRef.current?.duration;
      if (
        list.length === 0 &&
        source.tracks.length <= 1 &&
        elementDuration &&
        !Number.isNaN(elementDuration)
      ) {
        setChapters(generateAudioTracks(elementDuration));
        return;
      }
      setChapters(list);
    },
    [],
  );

  // Compute current chapter from chapters list and currentTime
  const currentChapter = useMemo<CurrentChapterInfo | null>(() => {
    if (!chapters || chapters.length === 0) return null;

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      if (currentTime >= chapter.start && currentTime < chapter.end) {
        return {
          number: chapter.number ?? i + 1,
          title: chapter.title || `Kapitel ${chapter.number ?? i + 1}`,
          start: chapter.start,
          end: chapter.end,
          durationInSeconds: chapter.durationInSeconds,
        };
      }
    }

    const last = chapters[chapters.length - 1];
    if (currentTime >= last.start) {
      return {
        number: last.number ?? chapters.length,
        title: last.title || `Kapitel ${last.number ?? chapters.length}`,
        start: last.start,
        end: last.end,
        durationInSeconds: last.durationInSeconds,
      };
    }

    return null;
  }, [chapters, currentTime]);

  const jumpToChapter = useCallback(
    (startTime: number) => {
      if (audioRef.current && typeof startTime === 'number' && !isNaN(startTime)) {
        seekBook(startTime);
        setCurrentTime(startTime);
      }
    },
    [seekBook],
  );

  // Sleep timer implementation
  const setSleepTimer = useCallback(
    (option: number | 'chapter' | null) => {
      if (sleepTimerIntervalRef.current) {
        clearInterval(sleepTimerIntervalRef.current);
        sleepTimerIntervalRef.current = null;
      }
      setSleepTimerMode(option);

      if (option === null) {
        setSleepTimerRemaining(null);
        return;
      }

      if (typeof option === 'number') {
        const totalSeconds = option * 60;
        setSleepTimerRemaining(totalSeconds);

        sleepTimerIntervalRef.current = setInterval(() => {
          setSleepTimerRemaining((prev) => {
            if (prev === null || prev <= 1) {
              clearInterval(sleepTimerIntervalRef.current);
              sleepTimerIntervalRef.current = null;
              pausePlayback();
              setSleepTimerMode(null);
              return null;
            }
            return prev - 1;
          });
        }, 1000);
      } else if (option === 'chapter') {
        setSleepTimerRemaining(null);
      }
    },
    [pausePlayback],
  );

  const shouldAutoPlayRef = useRef<boolean>(true);

  // Leaves the current book before another one loads: flushes its position,
  // closes a conflict prompt it opened and tears down the element stream.
  const releaseCurrentBook = useCallback(
    (nextProvider: ProviderId, nextKey: string) => {
      settlePositionConflict(null);

      // If switching from a previous book, flush its position bookmark immediately
      const prevSource = sourceRef.current;
      if (
        prevSource &&
        (prevSource.provider !== nextProvider || prevSource.bookKey !== nextKey) &&
        audioRef.current
      ) {
        const prevPosition = positionToSave(audioRef.current, prevSource);
        if (prevPosition > 0) {
          writeLocalPosition(
            prevSource.positionStorageKey,
            prevPosition,
            remoteSeenFor(prevSource),
          );
          writeRemote(prevSource, prevPosition).catch((err) => {
            console.warn('Failed to sync previous book bookmark position:', err);
          });
        }
      }

      // Stop and completely tear down the previous audio element stream
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
      if (positionUpdateIntervalRef.current) {
        clearInterval(positionUpdateIntervalRef.current);
        positionUpdateIntervalRef.current = null;
      }

      trackIndexRef.current = 0;
      pendingTrackStartRef.current = null;
      trackRemoteRef.current = false;
      awaitingStartPositionRef.current = true;
      urlRetriesRef.current = { index: -1, at: [] };
      remoteSeenRef.current = undefined;
      isPlayingRef.current = false;
      audioSrcRef.current = null;
      setIsPlaying(false);
      setCurrentTime(0);
      setAudioSrc(null);
    },
    [settlePositionConflict, writeRemote, remoteSeenFor, positionToSave],
  );

  // Main book loader
  const loadBook = useCallback(
    async (book: BookShelfEntity | null, bookId: string, autoPlay: boolean = true) => {
      const isMatchingBook =
        book &&
        (String(book.id) === String(bookId) ||
          String(book.abook?.id) === String(bookId) ||
          String(book.book?.consumableId) === String(bookId));
      const validBook = isMatchingBook ? book : null;
      const consumableId = validBook?.book?.consumableId || bookId;
      shouldAutoPlayRef.current = autoPlay;

      // If this book is already active and stream is loaded, don't restart
      if (
        sourceRef.current?.provider === 'storytel' &&
        activeBookIdRef.current === bookId &&
        audioSrcRef.current
      ) {
        if (validBook) setActiveBook(validBook);
        if (autoPlay && !isPlayingRef.current) resumePlayback();
        return;
      }

      const source = createStorytelSource(validBook, bookId);
      audiotekaLoadingIdRef.current = null;
      releaseCurrentBook(source.provider, source.bookKey);

      sourceRef.current = source;
      setDuration(source.tracks.length > 1 ? totalDurationMs(source.tracks) / 1000 : 0);

      // Persist session to local storage for quick restore
      storage
        .set('last_played_session', JSON.stringify({ book: validBook, bookId, consumableId }))
        .catch(() => {});

      const knownDurationSec = validBook?.abook?.time ? validBook.abook.time / 1000000 : 0;
      refreshChapters(source, knownDurationSec);

      const requestId = ++loadRequestIdRef.current;

      try {
        setIsLoading(true);
        setError(null);
        setActiveProvider('storytel');
        setActiveAudiotekaEntry(null);
        setActiveBook(validBook);
        activeBookIdRef.current = bookId;
        setActiveBookId(bookId);
        setActiveConsumableId(consumableId);
        setActiveSource(source);

        const { url, remote } = await source.resolveTrackUrl(0);
        // A newer load took over while this stream was being resolved
        if (requestId !== loadRequestIdRef.current) return;

        trackRemoteRef.current = remote;
        audioSrcRef.current = url;
        setAudioSrc(url);

        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.load();
        }
      } catch (err: any) {
        if (requestId !== loadRequestIdRef.current) return;
        console.error('Failed to load audio stream:', err);
        setError(errorMessage(err));
        setIsLoading(false);
      }
    },
    [refreshChapters, releaseCurrentBook, resumePlayback],
  );

  // Audioteka book loader. Never written to `last_played_session`, which
  // stays Storytel-only: an Audioteka book is not restored on launch.
  const loadAudiotekaBook = useCallback(
    async (entry: AudiotekaLibraryEntry, autoPlay: boolean = true) => {
      shouldAutoPlayRef.current = autoPlay;
      const current = sourceRef.current;
      const isActive =
        (current?.provider === 'audioteka' &&
          current.bookKey === entry.id &&
          !!audioSrcRef.current) ||
        audiotekaLoadingIdRef.current === entry.id;
      if (isActive) {
        // `shouldAutoPlayRef` above is what a load still in flight plays by
        setActiveAudiotekaEntry(entry);
        setActiveBook(audiotekaEntryToBookEntity(entry));
        // Reopened while paused: the phone may have moved the position
        if (audioSrcRef.current && !isPlayingRef.current) void resumeWithRemoteCheck(autoPlay);
        return;
      }

      releaseCurrentBook('audioteka', entry.id);
      sourceRef.current = null;
      audiotekaLoadingIdRef.current = entry.id;
      setDuration(entry.durationMs / 1000);
      setChapters([]);

      const requestId = ++loadRequestIdRef.current;
      setIsLoading(true);
      setError(null);
      setActiveProvider('audioteka');
      setActiveAudiotekaEntry(entry);
      setActiveBook(audiotekaEntryToBookEntity(entry));
      activeBookIdRef.current = entry.id;
      setActiveBookId(entry.id);
      setActiveConsumableId(entry.id);
      setActiveSource(null);

      try {
        const { tracks } = await fetchAudiotekaBook(entry.id);
        if (requestId !== loadRequestIdRef.current) return;
        audiotekaLoadingIdRef.current = null;
        if (tracks.length === 0) throw new Error(i18n.t('player.loadError'));

        const source = createAudiotekaSource(entry, tracks);
        sourceRef.current = source;
        setActiveSource(source);
        const durationSeconds = totalDurationMs(source.tracks) / 1000;
        setDuration(durationSeconds);
        refreshChapters(source, durationSeconds);

        const { url, remote } = await source.resolveTrackUrl(0);
        if (requestId !== loadRequestIdRef.current) return;

        trackRemoteRef.current = remote;
        audioSrcRef.current = url;
        setAudioSrc(url);
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.load();
        }
      } catch (err) {
        if (requestId !== loadRequestIdRef.current) return;
        audiotekaLoadingIdRef.current = null;
        console.error('Failed to load Audioteka book:', err);
        setError(errorMessage(err));
        setIsLoading(false);
      }
    },
    [refreshChapters, releaseCurrentBook, resumeWithRemoteCheck],
  );

  // Restore previous session on launch
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const raw = await storage.get('last_played_session');
        if (!raw) return;
        const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!isStorytelSession(saved)) {
          // Not a Storytel book (an Audioteka id from an earlier build): drop it
          await storage.remove('last_played_session');
          return;
        }
        if (!activeBookIdRef.current) {
          const book = (saved.book as BookShelfEntity | null | undefined) || null;
          const source = createStorytelSource(book, saved.bookId);
          sourceRef.current = source;
          trackIndexRef.current = 0;
          setActiveSource(source);
          setActiveProvider('storytel');
          setActiveBook(book);
          activeBookIdRef.current = saved.bookId;
          setActiveBookId(saved.bookId);
          const cid = saved.consumableId || saved.bookId;
          setActiveConsumableId(cid);
          const savedDurationSec = book?.abook?.time ? book.abook.time / 1000000 : 0;
          if (savedDurationSec > 0) {
            setDuration(savedDurationSec);
          }
          refreshChapters(source, savedDurationSec);
          const local = await readLocalPosition(source.positionStorageKey);
          if (local) {
            setCurrentTime(Math.floor(local.position / 1000));
          }
        }
      } catch (err) {
        console.warn('Failed to restore last played session:', err);
      }
    };
    restoreSession();
  }, [refreshChapters]);

  const togglePlayPause = useCallback(() => {
    if (!audioRef.current) return;
    // The start position is still being chosen in the conflict prompt
    if (conflictResolverRef.current) return;
    if (!audioSrc && activeBookId) {
      const audiotekaEntry = activeAudiotekaEntryRef.current;
      if (activeProvider === 'audioteka' && audiotekaEntry) {
        loadAudiotekaBook(audiotekaEntry, true);
      } else {
        loadBook(activeBook, activeBookId, true);
      }
      return;
    }
    // During a track switch the old track must not restart: flip what the
    // new track does once it has loaded instead.
    const pendingSwitch = pendingTrackStartRef.current;
    if (pendingSwitch) {
      if (pendingSwitch.play) pausePlayback();
      else resumePlayback();
      return;
    }
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      void resumeWithRemoteCheck(true);
    }
  }, [
    isPlaying,
    audioSrc,
    activeBookId,
    activeBook,
    activeProvider,
    loadBook,
    loadAudiotekaBook,
    pausePlayback,
    resumePlayback,
    resumeWithRemoteCheck,
  ]);

  const seek = useCallback(
    (seekTime: number) => {
      if (!audioRef.current) return;
      seekBook(seekTime);
      setCurrentTime(seekTime);
    },
    [seekBook],
  );

  const skipForward = useCallback(
    (seconds: number = 30) => {
      if (audioRef.current) {
        const nextTime = Math.min(
          bookSeconds(audioRef.current, sourceRef.current, trackIndexRef.current) + seconds,
          duration || audioRef.current.duration || Infinity,
        );
        seekBook(nextTime);
        setCurrentTime(nextTime);
        trackAction('skip_forward', {
          bookId: activeBookId,
          consumableId: activeConsumableId,
          seconds,
        });
      }
    },
    [duration, activeBookId, activeConsumableId, seekBook],
  );

  const skipBackward = useCallback(
    (seconds: number = 15) => {
      if (audioRef.current) {
        const nextTime = Math.max(
          bookSeconds(audioRef.current, sourceRef.current, trackIndexRef.current) - seconds,
          0,
        );
        seekBook(nextTime);
        setCurrentTime(nextTime);
        trackAction('skip_backward', {
          bookId: activeBookId,
          consumableId: activeConsumableId,
          seconds,
        });
      }
    },
    [activeBookId, activeConsumableId, seekBook],
  );

  const setRate = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  const cyclePlaybackRate = useCallback(() => {
    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
    const nextRate = PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length] || 1.0;
    setRate(nextRate);
  }, [playbackRate, setRate]);

  const setVolume = useCallback((newVolume: number) => {
    setVolumeState(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
    if (newVolume > 0) {
      setIsMuted(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.volume = previousVolume;
      setVolumeState(previousVolume);
      setIsMuted(false);
    } else {
      setPreviousVolume(volume);
      audioRef.current.volume = 0;
      setVolumeState(0);
      setIsMuted(true);
    }
  }, [isMuted, previousVolume, volume]);

  // Audio element listeners
  const onPlay = () => {
    setIsPlaying(true);
    if (positionUpdateIntervalRef.current) clearInterval(positionUpdateIntervalRef.current);
    const remoteEveryTicks = Math.max(
      1,
      Math.round(
        (activeSource?.remoteWriteIntervalMs ?? LOCAL_POSITION_INTERVAL_MS) /
          LOCAL_POSITION_INTERVAL_MS,
      ),
    );
    let ticks = 0;
    positionUpdateIntervalRef.current = setInterval(() => {
      ticks += 1;
      updatePosition(ticks % remoteEveryTicks === 0);
    }, LOCAL_POSITION_INTERVAL_MS);
    sourceRef.current?.onPlaybackStarted?.();
    trackAction('play', { bookId: activeBookId, consumableId: activeConsumableId });
    if (window.trayControls?.updatePlayingState) {
      window.trayControls.updatePlayingState(true, activeBook?.book?.name || null);
    }
  };

  // Bookkeeping of a stop: state, position, sync interval, analytics, tray
  const markPaused = (writePosition: boolean = true) => {
    setIsPlaying(false);
    if (writePosition) updatePosition();
    if (positionUpdateIntervalRef.current) {
      clearInterval(positionUpdateIntervalRef.current);
      positionUpdateIntervalRef.current = null;
    }
    trackAction('pause', { bookId: activeBookId, consumableId: activeConsumableId });
    if (window.trayControls?.updatePlayingState) {
      window.trayControls.updatePlayingState(false, activeBook?.book?.name || null);
    }
  };
  markPausedRef.current = markPaused;

  const onPause = () => {
    // Switching to another track of the same book is not a pause
    if (pendingTrackStartRef.current) return;
    // The element fires `pause` before `ended`: a track with a next one plays on
    const audio = audioRef.current;
    const source = sourceRef.current;
    if (audio?.ended && source && nextTrackIndex(source.tracks, trackIndexRef.current) !== null) {
      return;
    }
    markPaused();
  };

  const onTimeUpdate = () => {
    if (audioRef.current && !pendingTrackStartRef.current) {
      const cur = bookSeconds(audioRef.current, sourceRef.current, trackIndexRef.current);
      setCurrentTime(cur);
      if (sleepTimerMode === 'chapter' && currentChapter && cur >= currentChapter.end - 0.5) {
        pausePlayback();
        setSleepTimerMode(null);
      }
    }
  };

  const onLoadedMetadata = async () => {
    const audio = audioRef.current;
    const source = sourceRef.current;
    if (!audio || !source) return;

    // Another track of the current book: start it where the timeline asked
    const pendingStart = pendingTrackStartRef.current;
    if (pendingStart) {
      pendingTrackStartRef.current = null;
      audio.currentTime = pendingStart.offsetSeconds;
      setCurrentTime(bookSeconds(audio, source, trackIndexRef.current));
      setIsLoading(false);
      audio.playbackRate = playbackRate;
      if (pendingStart.play) {
        audio.play().catch(console.error);
      }
      return;
    }

    const audioDuration = audio.duration;
    if (source.tracks.length <= 1 && audioDuration && !Number.isNaN(audioDuration)) {
      if (source.tracks[0]) source.tracks[0].durationMs = Math.round(audioDuration * 1000);
      setDuration(audioDuration);
      setChapters((prev) => {
        if (!prev || prev.length === 0) {
          return generateAudioTracks(audioDuration);
        }
        return prev;
      });
    }
    awaitingStartPositionRef.current = false;
    const switchedTrack = await goToPosition(source, shouldAutoPlayRef.current);
    if (switchedTrack || sourceRef.current !== source) return;
    setIsLoading(false);
    audio.playbackRate = playbackRate;
    if (shouldAutoPlayRef.current) {
      audio.play().catch(console.error);
    }
  };

  const onEnded = () => {
    // A multi-track book plays on into its next track
    const source = sourceRef.current;
    const next = source ? nextTrackIndex(source.tracks, trackIndexRef.current) : null;
    if (source && next !== null) {
      loadTrack(source, next, { offsetSeconds: 0, play: true });
      return;
    }
    setIsPlaying(false);
    updatePosition();
  };

  // A signed track URL the element could not play (expired, CDN 403): forget
  // it, ask the provider again and continue at the same offset. Returns false
  // when the source has no URL cache, the track is local, or the retries of
  // this track are used up.
  const retryTrackUrl = (): boolean => {
    const audio = audioRef.current;
    const source = sourceRef.current;
    if (!audio || !source?.invalidateTrackUrl || !trackRemoteRef.current) return false;

    const index = trackIndexRef.current;
    const retries = nextUrlRetry(
      urlRetriesRef.current,
      index,
      Date.now(),
      URL_RETRY_LIMIT,
      URL_RETRY_WINDOW_MS,
    );
    if (!retries) return false;
    urlRetriesRef.current = retries;

    console.warn(`Track ${index} URL failed, resolving it again`);
    source.invalidateTrackUrl(index);
    const pending = pendingTrackStartRef.current;
    if (pending) {
      loadTrack(source, index, { offsetSeconds: pending.offsetSeconds, play: pending.play });
    } else if (awaitingStartPositionRef.current) {
      // The saved position has not been applied yet: the reload applies it
      loadTrack(source, index, null);
    } else {
      const offsetSeconds = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      loadTrack(source, index, { offsetSeconds, play: isPlayingRef.current || !audio.paused });
    }
    return true;
  };

  const onError = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    console.error('Audio error:', e);
    const pending = pendingTrackStartRef.current;
    // The old track failing while the next one's URL is still resolving: the
    // switch replaces it anyway
    if (pending && pending.index !== trackIndexRef.current) return;
    if (retryTrackUrl()) return;

    setIsLoading(false);
    const retriable = !!sourceRef.current?.invalidateTrackUrl && trackRemoteRef.current;
    if (retriable) setError(i18n.t('player.loadError'));
    // A failed track switch: drop it (and any URL request still in
    // flight) so the next attempt starts clean. The track index always
    // matches the element's src, so it needs no change.
    if (pending) {
      pendingTrackStartRef.current = null;
      loadRequestIdRef.current += 1;
      markPaused(false);
      return;
    }
    if (retriable && !audioRef.current?.paused) {
      audioRef.current?.pause();
      return;
    }
    setIsPlaying(false);
  };

  // Hardware media keys and the OS media controls go through the same
  // play/pause as the UI (a pending track switch, the resume re-check)
  const togglePlayPauseRef = useRef(togglePlayPause);
  togglePlayPauseRef.current = togglePlayPause;
  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession) return;
    mediaSession.setActionHandler('play', () => {
      if (!isPlayingRef.current) togglePlayPauseRef.current();
    });
    mediaSession.setActionHandler('pause', () => {
      if (isPlayingRef.current) togglePlayPauseRef.current();
    });
    return () => {
      mediaSession.setActionHandler('play', null);
      mediaSession.setActionHandler('pause', null);
    };
  }, []);

  // Tray play/pause listeners
  useEffect(() => {
    if (window.trayControls?.onPlayPause) {
      window.trayControls.onPlayPause(() => {
        togglePlayPause();
      });
    }
  }, [togglePlayPause]);

  // Cleanup on unmount & save on window close
  useEffect(() => {
    // On quit (or reload) the local write keeps `remoteSeen`; an `ask` source
    // also sends its remote write, which the main process lets finish before
    // it quits (`ServerManager.settle`). If that write is lost, the kept
    // `remoteSeen` still matches the remote, so the next open does not ask.
    const handleBeforeUnload = () => {
      const source = sourceRef.current;
      if (audioRef.current && source && audioSrcRef.current) {
        const position = positionToSave(audioRef.current, source);
        if (position > 0) {
          writeLocalPosition(source.positionStorageKey, position, remoteSeenFor(source));
          if (source.conflictPolicy === 'ask') {
            source.writeRemotePosition(position).catch(() => {});
          }
        }
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (positionUpdateIntervalRef.current) {
        clearInterval(positionUpdateIntervalRef.current);
      }
      if (sleepTimerIntervalRef.current) {
        clearInterval(sleepTimerIntervalRef.current);
      }
    };
  }, [positionToSave, remoteSeenFor]);

  return (
    <AudioContext.Provider
      value={{
        activeBook,
        activeProvider,
        activeAudiotekaEntry,
        activeBookId,
        activeConsumableId,
        audioSrc,
        isLoading,
        isPlaying,
        currentTime,
        duration,
        playbackRate,
        volume,
        isMuted,
        audioRef,
        chapters,
        currentChapter,
        loadBook,
        loadAudiotekaBook,
        togglePlayPause,
        seek,
        skipForward,
        skipBackward,
        setRate,
        cyclePlaybackRate,
        setVolume,
        toggleMute,
        jumpToChapter,
        sleepTimerRemaining,
        sleepTimerMode,
        setSleepTimer,
        error,
        setError,
      }}
    >
      {/* Central persistent audio element */}
      <audio
        ref={audioRef}
        onPlay={onPlay}
        onPause={onPause}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
        onError={onError}
      />
      <PositionConflictModal conflict={positionConflict} onChoose={settlePositionConflict} />
      {children}
    </AudioContext.Provider>
  );
}

export function useAudioContext() {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudioContext must be used within an AudioProvider');
  }
  return context;
}
