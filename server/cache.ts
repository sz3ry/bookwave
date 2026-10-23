// A small in-memory TTL cache, shared by the Storytel and Audioteka clients
// for catalogue (discovery) responses.

export const CACHE_TTL_MS = 3_600_000;

export function createTtlCache<T>(
  ttlMs: number,
  now: () => number = Date.now,
): { get(key: string): T | undefined; set(key: string, v: T): void } {
  const entries = new Map<string, { value: T; expires: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() >= entry.expires) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { value, expires: now() + ttlMs });
    },
  };
}
