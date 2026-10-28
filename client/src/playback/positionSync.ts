/**
 * Local position as written under `pos:<id>`. `remoteSeen` is the last remote
 * position Bookwave saw or wrote, used to tell whether another device moved it.
 */
export interface StoredPosition {
  position: number;
  updatedAt: string;
  remoteSeen?: number;
}

/**
 * How a source settles a provider position another device moved: `ask` lets
 * the user choose (Audioteka), `follow` jumps to the provider's position
 * without asking (Storytel).
 */
export type ConflictPolicy = 'ask' | 'follow';

/**
 * The record written under `pos:<id>`. Every local write (the 15 s tick, a
 * book switch, app quit) carries the `remoteSeen` Bookwave
 * currently knows; dropping it would make the next open ask about a remote
 * value Bookwave itself wrote.
 */
export function storedPosition(
  position: number,
  remoteSeen: number | undefined,
  now: Date = new Date(),
): StoredPosition {
  return {
    position,
    updatedAt: now.toISOString(),
    ...(remoteSeen === undefined ? {} : { remoteSeen }),
  };
}

/**
 * The stored record after a remote write of `writtenPosition` succeeded: only
 * `remoteSeen` changes. A local write that happened while the request ran is
 * newer than the written value, so its position (and time) is kept; the
 * written position is used only when nothing is stored.
 */
export function withRemoteSeen(
  stored: StoredPosition | null,
  writtenPosition: number,
  now: Date = new Date(),
): StoredPosition {
  if (!stored) return storedPosition(writtenPosition, writtenPosition, now);
  return { ...stored, remoteSeen: writtenPosition };
}

export type StartPosition =
  | { kind: 'use'; positionMs: number; source: 'local' | 'remote' }
  | { kind: 'ask'; localMs: number; remoteMs: number; device: string | null };

/**
 * The position a book opens (or resumes) at. The provider's position wins only
 * when another device moved it since Bookwave last saw it and it differs from
 * the local one by more than `thresholdMs`; `ask` then lets the user choose,
 * `follow` takes the provider's position. Without a `remoteSeen` (a record from
 * before Bookwave tracked it, or one never synced) `follow` cannot tell another
 * device's move from Bookwave's own unsent listening, so it takes the
 * provider's position only when its `updatedTime` is newer than the local one.
 */
export function resolveStartPosition(
  local: StoredPosition | null,
  remote: { positionMs: number; device: string | null; updatedTime?: string } | null,
  policy: ConflictPolicy = 'ask',
  thresholdMs = 30_000,
): StartPosition {
  if (!local) {
    return { kind: 'use', positionMs: remote?.positionMs ?? 0, source: 'remote' };
  }
  const useLocal: StartPosition = {
    kind: 'use',
    positionMs: local.position,
    source: 'local',
  };
  if (!remote) return useLocal;
  if (remote.positionMs === local.remoteSeen) return useLocal;
  if (Math.abs(local.position - remote.positionMs) <= thresholdMs) {
    return useLocal;
  }
  if (policy === 'follow') {
    if (local.remoteSeen === undefined) {
      const remoteTime = remote.updatedTime ? Date.parse(remote.updatedTime) : 0;
      if (!(remoteTime > Date.parse(local.updatedAt))) return useLocal;
    }
    return { kind: 'use', positionMs: remote.positionMs, source: 'remote' };
  }
  return {
    kind: 'ask',
    localMs: local.position,
    remoteMs: remote.positionMs,
    device: remote.device,
  };
}

/**
 * Whether resuming a paused book (or reopening the active one) asks the
 * provider for its position again: never during a track switch or before the book's start position was applied, and at most
 * once per `minIntervalMs` per book. `lastCheckAt` is null when this book
 * was never checked.
 */
export function shouldRecheckRemote(options: {
  switching: boolean;
  awaitingStart: boolean;
  lastCheckAt: number | null;
  now: number;
  minIntervalMs?: number;
}): boolean {
  const { switching, awaitingStart, lastCheckAt, now, minIntervalMs = 10_000 } = options;
  if (switching || awaitingStart) return false;
  return lastCheckAt === null || now - lastCheckAt >= minIntervalMs;
}

/**
 * Whether a position is sent to the provider: only a position Bookwave itself
 * moved since the last sync. One within `toleranceMs` of `remoteSeen` is what
 * the provider already had, and resending it would overwrite a newer position
 * another device stored meanwhile.
 */
export function shouldWriteRemote(
  positionMs: number,
  remoteSeen: number | undefined,
  toleranceMs = 1000,
): boolean {
  if (remoteSeen === undefined) return true;
  return Math.abs(positionMs - remoteSeen) > toleranceMs;
}
