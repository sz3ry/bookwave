import { locate, type TimelineTrack } from './timeline';

/**
 * Pure decisions behind the audio context's book timeline. A single-track
 * book plays from one element whose time is the book time: its track
 * duration may still be unknown (0), so it never goes through `locate`.
 */

/** Book time in seconds for the element's time inside the loaded track. */
export function bookSeconds(
  tracks: TimelineTrack[],
  trackIndex: number,
  elementSeconds: number,
): number {
  if (tracks.length <= 1) return elementSeconds;
  return (tracks[trackIndex]?.startMs ?? 0) / 1000 + elementSeconds;
}

export type SeekPlan =
  /** Stay on the loaded track and set the element to `seconds`. */
  | { kind: 'element'; seconds: number }
  /** Load track `index` and start it at `offsetSeconds`. */
  | { kind: 'track'; index: number; offsetSeconds: number };

/** Where a seek to a book position lands; `currentIndex` -1 means no usable loaded track. */
export function planSeek(
  tracks: TimelineTrack[],
  currentIndex: number,
  bookSecondsTarget: number,
): SeekPlan {
  if (tracks.length <= 1) return { kind: 'element', seconds: bookSecondsTarget };
  const { index, offsetMs } = locate(tracks, bookSecondsTarget * 1000);
  if (index === currentIndex) return { kind: 'element', seconds: offsetMs / 1000 };
  return { kind: 'track', index, offsetSeconds: offsetMs / 1000 };
}

/** The track to continue with after `currentIndex` ends, or null on the last one. */
export function nextTrackIndex(tracks: TimelineTrack[], currentIndex: number): number | null {
  return currentIndex < tracks.length - 1 ? currentIndex + 1 : null;
}

/** Recent automatic URL re-resolves of one track (epoch ms). */
export interface UrlRetries {
  index: number;
  at: number[];
}

/**
 * Whether track `index` may resolve its URL again after a playback error:
 * at most `limit` times within `windowMs`. Returns the updated history, or
 * null when the retries are used up.
 */
export function nextUrlRetry(
  history: UrlRetries,
  index: number,
  now: number,
  limit = 2,
  windowMs = 10_000,
): UrlRetries | null {
  const recent = history.index === index ? history.at.filter((at) => now - at < windowMs) : [];
  if (recent.length >= limit) return null;
  return { index, at: [...recent, now] };
}
