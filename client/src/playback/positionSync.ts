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
 * The record written under `pos:<id>`. Every local write of an `ask` source
 * (the 15 s tick, a book switch, app quit) carries the `remoteSeen` Bookwave
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

export type StartPosition =
  | { kind: 'use'; positionMs: number; source: 'local' | 'remote' }
  | { kind: 'ask'; localMs: number; remoteMs: number; device: string | null };

export function resolveStartPosition(
  local: StoredPosition | null,
  remote: { positionMs: number; device: string | null } | null,
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
  return {
    kind: 'ask',
    localMs: local.position,
    remoteMs: remote.positionMs,
    device: remote.device,
  };
}

/**
 * Whether resuming a paused book (or reopening the active one) asks the
 * provider for its position again: only for `ask` sources, never during a
 * track switch or before the book's start position was applied, and at most
 * once per `minIntervalMs` per book. `lastCheckAt` is null when this book
 * was never checked.
 */
export function shouldRecheckRemote(options: {
  policy: 'newest' | 'ask';
  switching: boolean;
  awaitingStart: boolean;
  lastCheckAt: number | null;
  now: number;
  minIntervalMs?: number;
}): boolean {
  const { policy, switching, awaitingStart, lastCheckAt, now, minIntervalMs = 10_000 } = options;
  if (policy !== 'ask' || switching || awaitingStart) return false;
  return lastCheckAt === null || now - lastCheckAt >= minIntervalMs;
}

/**
 * Whether a position is sent to the provider. An `ask` source sends only a
 * position Bookwave itself moved since the last sync: one within `toleranceMs`
 * of `remoteSeen` is what the provider already had, and resending it would
 * overwrite a newer position another device stored meanwhile. `newest`
 * sources (Storytel) always send.
 */
export function shouldWriteRemote(
  policy: 'newest' | 'ask',
  positionMs: number,
  remoteSeen: number | undefined,
  toleranceMs = 1000,
): boolean {
  if (policy !== 'ask' || remoteSeen === undefined) return true;
  return Math.abs(positionMs - remoteSeen) > toleranceMs;
}
