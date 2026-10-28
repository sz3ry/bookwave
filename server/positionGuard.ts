/**
 * A guarded position write carries `ifRemoteAt`, the provider position Bookwave
 * last saw. It is skipped when the provider now holds another one: a device
 * moved the book meanwhile, and a paused Bookwave (quitting, switching books,
 * retrying a pause write that failed offline) must not overwrite that.
 */
export function remoteMovedSince(
  current: number | null | undefined,
  ifRemoteAt: unknown,
  toleranceMs = 1000,
): boolean {
  if (typeof ifRemoteAt !== 'number' || !Number.isFinite(ifRemoteAt)) return false;
  if (typeof current !== 'number') return false;
  return Math.abs(current - ifRemoteAt) > toleranceMs;
}
