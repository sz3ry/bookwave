/**
 * Local position as written under `pos:<id>`. `remoteSeen` is the last remote
 * position Bookwave saw or wrote, used to tell whether another device moved it.
 */
export interface StoredPosition {
  position: number;
  updatedAt: string;
  remoteSeen?: number;
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
