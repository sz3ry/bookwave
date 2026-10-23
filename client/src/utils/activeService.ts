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
 * single last session into its per-service key when that slot is empty (the legacy
 * key stays until the player reads the new keys), and persists the resolved service
 * only when none is stored, so a stored choice survives a temporary logout.
 */
export async function resolveAndPersistActive(
  store: KeyValueStore,
  login: { storytel: boolean; audioteka: boolean },
): Promise<ProviderId | null> {
  const stored = asProviderId(parseStored(await store.get(ACTIVE_SERVICE_KEY)));
  const legacySession = parseStored(await store.get(LEGACY_SESSION_KEY));
  const legacy = migrateLegacySession(legacySession);
  if (legacy && !(await store.get(lastSessionKey(legacy.provider)))) {
    await store.set(lastSessionKey(legacy.provider), JSON.stringify(legacy.record));
  }
  const active = resolveActiveService({ stored, ...login, legacySession });
  if (active && !stored) await store.set(ACTIVE_SERVICE_KEY, JSON.stringify(active));
  return active;
}
