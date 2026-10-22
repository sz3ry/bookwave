/** One audio file of a multi-track book, placed on the continuous book timeline. */
export interface TimelineTrack {
  id: string;
  startMs: number;
  durationMs: number;
}

/**
 * Maps a book position to a track and an offset inside it. Positions below 0
 * clamp to the start, positions past the end clamp to the end of the last
 * track. A position exactly on a boundary belongs to the next track.
 */
export function locate(
  tracks: TimelineTrack[],
  positionMs: number,
): { index: number; offsetMs: number } {
  if (tracks.length === 0) {
    throw new Error('Cannot locate a position: the timeline has no tracks');
  }
  if (!(positionMs > 0)) return { index: 0, offsetMs: 0 };

  const lastIndex = tracks.length - 1;
  for (let index = 0; index < lastIndex; index++) {
    const track = tracks[index];
    if (positionMs < track.startMs + track.durationMs) {
      return { index, offsetMs: Math.max(0, positionMs - track.startMs) };
    }
  }
  const last = tracks[lastIndex];
  return {
    index: lastIndex,
    offsetMs: Math.min(Math.max(0, positionMs - last.startMs), last.durationMs),
  };
}

export function totalDurationMs(tracks: TimelineTrack[]): number {
  const last = tracks[tracks.length - 1];
  return last ? last.startMs + last.durationMs : 0;
}

const URL_EXPIRY_MARGIN_MS = 300_000;

/** Caches signed track URLs; an entry is dropped 5 minutes before it expires. */
export function createTrackUrlCache(now: () => number = Date.now) {
  const entries = new Map<string, { url: string; expiresAt: number }>();
  return {
    get(trackId: string): string | undefined {
      const entry = entries.get(trackId);
      if (!entry) return undefined;
      if (now() >= entry.expiresAt - URL_EXPIRY_MARGIN_MS) {
        entries.delete(trackId);
        return undefined;
      }
      return entry.url;
    },
    set(trackId: string, url: string, expiresAt: number): void {
      entries.set(trackId, { url, expiresAt });
    },
    invalidate(trackId: string): void {
      entries.delete(trackId);
    },
  };
}
