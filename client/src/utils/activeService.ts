import type { ProviderId } from '../interfaces/library';
import { migrateLegacySession } from '../playback/lastSession';

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
