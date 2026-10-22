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
import { type BookShelfEntity, BookMetaData } from '../interfaces/books';
import type { Chapter } from '../interfaces/chapters';
import { generateAudioTracks } from '../utils/chapters';
import i18n from '../i18n';
import { createStorytelSource, type PlaybackSource } from '../playback/sources';
import { totalDurationMs } from '../playback/timeline';
import {
  bookSeconds as timelineSeconds,
  nextTrackIndex,
  planSeek,
} from '../playback/trackNavigation';
import { resolveStartPosition, type StoredPosition } from '../playback/positionSync';

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

const writeLocalPosition = async (storageKey: string, position: number) => {
  try {
    const payload: StoredPosition = {
      position,
      updatedAt: new Date().toISOString(),
    };
    await storage.set(storageKey, JSON.stringify(payload));
  } catch {
    // best-effort cache; ignore failures
  }
};

// Local positions are written at this pace while playing; a source's remote
// writes happen on every n-th of these ticks (`remoteWriteIntervalMs`).
const LOCAL_POSITION_INTERVAL_MS = 15000;

/** Current position on the book timeline, in seconds (see `trackNavigation`). */
const bookSeconds = (
  audio: HTMLAudioElement,
  source: PlaybackSource | null,
  trackIndex: number,
): number =>
  source ? timelineSeconds(source.tracks, trackIndex, audio.currentTime) : audio.currentTime;

/** Start position in ms chosen from the local cache and the provider's position. */
const chooseStartPosition = (
  source: PlaybackSource,
  local: StoredPosition | null,
  remote: Awaited<ReturnType<PlaybackSource['readRemotePosition']>>,
): number => {
  if (source.conflictPolicy === 'ask') {
    const start = resolveStartPosition(local, remote);
    // The conflict prompt is not wired yet: keep this device's position.
    return start.kind === 'use' ? start.positionMs : start.localMs;
  }
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
  activeBook: BookShelfEntity | null;
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
  // the URL request until the new track's metadata has loaded): the offset to
  // start it at, and whether it plays then. Element pause/time events of the
  // old track are not the book's while it is set.
  const pendingTrackStartRef = useRef<{ offsetSeconds: number; play: boolean } | null>(null);
  // The latest `markPaused`, for callbacks that keep a stable identity.
  const markPausedRef = useRef<(writePosition?: boolean) => void>(() => {});
  // Discards a slow stream/track URL response once a newer load has taken over.
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    activeBookIdRef.current = activeBookId;
    audioSrcRef.current = audioSrc;
    isPlayingRef.current = isPlaying;
  });

  // Position synchronization helper
  const updatePosition = useCallback(
    async (writeRemote: boolean = true) => {
      if (!audioRef.current || !activeSource) return;

      const position = Math.floor(
        bookSeconds(audioRef.current, activeSource, trackIndexRef.current) * 1000,
      );
      // Always persist locally first so offline listening is preserved
      await writeLocalPosition(activeSource.positionStorageKey, position);
      if (!writeRemote) return;

      try {
        await activeSource.writeRemotePosition(position);
      } catch (err) {
        console.warn('Failed to sync position to API, kept locally', err);
      }
    },
    [activeSource],
  );

  // Switch the element to another track of the current book
  const loadTrack = useCallback(
    async (source: PlaybackSource, index: number, offsetSeconds: number, play: boolean) => {
      const audio = audioRef.current;
      if (!audio) return;
      const requestId = ++loadRequestIdRef.current;
      pendingTrackStartRef.current = { offsetSeconds, play };
      try {
        const { url } = await source.resolveTrackUrl(index);
        if (requestId !== loadRequestIdRef.current) return;

        trackIndexRef.current = index;
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
      loadTrack(
        source,
        plan.index,
        plan.offsetSeconds,
        play ?? (pending ? pending.play : !audio.paused),
      );
      return true;
    },
    [loadTrack],
  );

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

      const local = await readLocalPosition(source.positionStorageKey);
      const chosenPosition = chooseStartPosition(source, local, remote);

      if (sourceRef.current !== source || !audioRef.current) return false;
      const switched = seekBook(Math.floor(chosenPosition / 1000), play);
      if (!switched) {
        setCurrentTime(bookSeconds(audioRef.current, source, trackIndexRef.current));
      }
      return switched;
    },
    [seekBook],
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
  const setSleepTimer = useCallback((option: number | 'chapter' | null) => {
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
            if (audioRef.current) {
              audioRef.current.pause();
            }
            setSleepTimerMode(null);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (option === 'chapter') {
      setSleepTimerRemaining(null);
    }
  }, []);

  const shouldAutoPlayRef = useRef<boolean>(true);

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
      if (activeBookIdRef.current === bookId && audioSrcRef.current) {
        if (validBook) setActiveBook(validBook);
        if (autoPlay && audioRef.current && !isPlayingRef.current) {
          audioRef.current.play().catch(console.error);
        }
        return;
      }

      const source = createStorytelSource(validBook, bookId);

      // If switching from a previous book, flush its position bookmark immediately
      const prevSource = sourceRef.current;
      if (
        prevSource &&
        (prevSource.provider !== source.provider || prevSource.bookKey !== source.bookKey) &&
        audioRef.current
      ) {
        const prevPosition = Math.floor(
          bookSeconds(audioRef.current, prevSource, trackIndexRef.current) * 1000,
        );
        if (prevPosition > 0) {
          writeLocalPosition(prevSource.positionStorageKey, prevPosition);
          prevSource.writeRemotePosition(prevPosition).catch((err) => {
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

      sourceRef.current = source;
      trackIndexRef.current = 0;
      pendingTrackStartRef.current = null;
      isPlayingRef.current = false;
      audioSrcRef.current = null;
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(source.tracks.length > 1 ? totalDurationMs(source.tracks) / 1000 : 0);
      setAudioSrc(null);

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
        setActiveBook(validBook);
        activeBookIdRef.current = bookId;
        setActiveBookId(bookId);
        setActiveConsumableId(consumableId);
        setActiveSource(source);

        const { url } = await source.resolveTrackUrl(0);
        // A newer load took over while this stream was being resolved
        if (requestId !== loadRequestIdRef.current) return;

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
    [refreshChapters],
  );

  // Restore previous session on launch
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const raw = await storage.get('last_played_session');
        if (!raw) return;
        const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (saved?.bookId && !activeBookIdRef.current) {
          const source = createStorytelSource(saved.book || null, saved.bookId);
          sourceRef.current = source;
          trackIndexRef.current = 0;
          setActiveSource(source);
          setActiveBook(saved.book || null);
          activeBookIdRef.current = saved.bookId;
          setActiveBookId(saved.bookId);
          const cid = saved.consumableId || saved.bookId;
          setActiveConsumableId(cid);
          const savedDurationSec = saved.book?.abook?.time ? saved.book.abook.time / 1000000 : 0;
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
    if (!audioSrc && activeBookId) {
      loadBook(activeBook, activeBookId, true);
      return;
    }
    // During a track switch the old track must not restart: flip what the
    // new track does once it has loaded instead.
    const pendingSwitch = pendingTrackStartRef.current;
    if (pendingSwitch) {
      pendingSwitch.play = !pendingSwitch.play;
      if (pendingSwitch.play) {
        setIsPlaying(true);
      } else {
        if (!audioRef.current.paused) audioRef.current.pause();
        markPausedRef.current();
      }
      return;
    }
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(console.error);
    }
  }, [isPlaying, audioSrc, activeBookId, activeBook, loadBook]);

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
        audioRef.current.pause();
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
      loadTrack(source, next, 0, true);
      return;
    }
    setIsPlaying(false);
    updatePosition();
  };

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
    const handleBeforeUnload = () => {
      const source = sourceRef.current;
      if (audioRef.current && source) {
        const position = Math.floor(
          bookSeconds(audioRef.current, source, trackIndexRef.current) * 1000,
        );
        if (position > 0) {
          writeLocalPosition(source.positionStorageKey, position);
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
  }, []);

  return (
    <AudioContext.Provider
      value={{
        activeBook,
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
        onError={(e) => {
          console.error('Audio error:', e);
          setIsLoading(false);
          // A failed track switch: drop it (and any URL request still in
          // flight) so the next attempt starts clean. The track index always
          // matches the element's src, so it needs no change.
          if (pendingTrackStartRef.current) {
            pendingTrackStartRef.current = null;
            loadRequestIdRef.current += 1;
            markPaused(false);
            return;
          }
          setIsPlaying(false);
        }}
      />
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
