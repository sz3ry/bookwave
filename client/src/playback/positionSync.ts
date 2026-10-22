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
