import type { ProviderId } from '../interfaces/library';
import { lastSessionKey, migrateLegacySession } from '../playback/lastSession';

/**
 * Picks the active service: the stored one if still logged in, else the owner of the
 * legacy last session, else the only logged-in one, Storytel when both; null when none.
 */
export function resolveActiveService(input: {
  stored: ProviderId | null;
  storytel: boolean;
  audioteka: boolean;
  legacySession: unknown;
}): ProviderId | null {
  const loggedIn: Record<ProviderId, boolean> = {
    storytel: input.storytel,
    audioteka: input.audioteka,
  };
  if (input.stored && loggedIn[input.stored]) return input.stored;
  const legacy = migrateLegacySession(input.legacySession);
  if (legacy && loggedIn[legacy.provider]) return legacy.provider;
  if (loggedIn.storytel) return 'storytel';
  if (loggedIn.audioteka) return 'audioteka';
  return null;
}

export const ACTIVE_SERVICE_KEY = 'activeService';
export const LEGACY_SESSION_KEY = 'last_played_session';

export interface KeyValueStore {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: string) => Promise<unknown>;
  remove: (key: string) => Promise<unknown>;
}

const parseStored = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const asProviderId = (value: unknown): ProviderId | null =>
  value === 'storytel' || value === 'audioteka' ? value : null;

/**
 * Resolves the active service and runs the store side effects: copies the legacy
 * single last session into its per-service key when that slot is empty, then removes
 * the legacy key (nothing reads it any more) once its owner hint has served to pick a
 * service, and persists the resolved service only when none is stored, so a stored
 * choice survives a temporary logout.
 */
export async function resolveAndPersistActive(
  store: KeyValueStore,
  login: { storytel: boolean; audioteka: boolean },
): Promise<ProviderId | null> {
  const stored = asProviderId(parseStored(await store.get(ACTIVE_SERVICE_KEY)));
  const legacyRaw = await store.get(LEGACY_SESSION_KEY);
  const legacySession = parseStored(legacyRaw);
  const legacy = migrateLegacySession(legacySession);
  if (legacy && !(await store.get(lastSessionKey(legacy.provider)))) {
    await store.set(lastSessionKey(legacy.provider), JSON.stringify(legacy.record));
  }
  const active = resolveActiveService({ stored, ...login, legacySession });
  // Kept while nobody is logged in: its owner still picks the service at the next login
  if (legacyRaw != null && active) await store.remove(LEGACY_SESSION_KEY);
  if (active && !stored) await store.set(ACTIVE_SERVICE_KEY, JSON.stringify(active));
  return active;
}

/**
 * True when a route belongs to a service that is not the active one; such a page
 * (e.g. a book page left open across a switch) must not stay usable.
 */
export function isOtherServiceRoute(route: ProviderId, active: ProviderId | null): boolean {
  return active !== null && route !== active;
}

/**
 * Orders `setActive` against overlapping state refreshes: a refresh that began
 * before the latest `setActive` must not replace the service that call chose.
 */
export function createActiveGuard() {
  let claims = 0;
  return {
    /** Called when a refresh starts; pass the result to `pick`. */
    begin: (): number => claims,
    /** Called by `setActive` before it writes. */
    claim: (): void => {
      claims += 1;
    },
    /** The active service a refresh may apply: its own, unless `setActive` ran since. */
    pick: (
      startedAt: number,
      resolved: ProviderId | null,
      current: ProviderId | null,
    ): ProviderId | null => (startedAt === claims ? resolved : current),
  };
}
