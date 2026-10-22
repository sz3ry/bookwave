// Pure mappers for Audioteka (HAL) responses: library lists, audiobook
// details, track timelines and remote playback positions.

export interface AudiotekaBook {
  id: string;
  title: string;
  authors: string[];
  narrators: string[];
  coverUrl: string | null;
  durationMs: number;
}

export type LibrarySource = 'recent' | 'favourite' | 'shelf';

export interface AudiotekaLibraryEntry extends AudiotekaBook {
  sources: LibrarySource[];
  // Filled in later from the license channels; fails open.
  available: boolean;
  positionMs: number | null;
}

export interface AudiotekaTrack {
  id: string;
  index: number;
  durationMs: number;
  startMs: number;
}

export interface AudiotekaRemotePosition {
  positionMs: number;
  device: string | null;
}

const UNLISTENABLE_STATES = new Set(['CAN_BUY', 'NOT_AVAILABLE']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const embeddedOf = (raw: unknown, rel: string): unknown[] => {
  if (!isRecord(raw) || !isRecord(raw._embedded)) return [];
  const items = raw._embedded[rel];
  return Array.isArray(items) ? items : [];
};

export function embeddedItems(raw: unknown): unknown[] {
  if (!isRecord(raw) || !isRecord(raw._embedded)) return [];
  return Object.values(raw._embedded).flatMap((value) => (Array.isArray(value) ? value : []));
}

const pickStrings = (items: unknown[], key: 'value' | 'name'): string[] =>
  items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const text = item[key];
    return typeof text === 'string' && text ? [text] : [];
  });

const listField = (raw: Record<string, unknown>, field: string, rel: string): string[] => {
  const direct = raw[field];
  if (Array.isArray(direct)) return pickStrings(direct, 'value');
  return pickStrings(embeddedOf(raw, rel), 'name');
};

export function toAudiotekaBook(raw: unknown): AudiotekaBook | null {
  if (!isRecord(raw)) return null;
  const { id, name } = raw;
  if (typeof id !== 'string' || !id || typeof name !== 'string') return null;
  return {
    id,
    title: name,
    authors: listField(raw, 'authors', 'app:author'),
    narrators: listField(raw, 'lectors', 'app:lector'),
    coverUrl: typeof raw.image_url === 'string' && raw.image_url ? raw.image_url : null,
    durationMs: asNumber(raw.tracks_duration_in_ms) ?? 0,
  };
}

export function mergeLibrary(
  lists: { recent: unknown; favourites: unknown; shelf: unknown },
  positions: unknown,
): AudiotekaLibraryEntry[] {
  const positionById = new Map<string, number>();
  for (const entry of embeddedOf(positions, 'app:playback-progress')) {
    if (!isRecord(entry)) continue;
    const position = asNumber(entry.position);
    if (typeof entry.product_id === 'string' && position !== null) {
      positionById.set(entry.product_id, position);
    }
  }

  const entries = new Map<string, AudiotekaLibraryEntry>();
  const ordered: [LibrarySource, unknown][] = [
    ['recent', lists.recent],
    ['favourite', lists.favourites],
    ['shelf', lists.shelf],
  ];
  for (const [source, raw] of ordered) {
    for (const item of embeddedItems(raw)) {
      const book = toAudiotekaBook(item);
      if (!book) continue;
      const existing = entries.get(book.id);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        continue;
      }
      entries.set(book.id, {
        ...book,
        sources: [source],
        available: true,
        positionMs: positionById.get(book.id) ?? null,
      });
    }
  }
  return [...entries.values()];
}

// Fails open: only a book whose every stated channel is buy-only or
// unavailable is reported as not listenable.
export function isListenable(channels: unknown): boolean {
  if (!isRecord(channels)) return true;
  const states = Object.values(channels).flatMap((channel) =>
    isRecord(channel) && typeof channel.state === 'string' ? [channel.state] : [],
  );
  if (states.length === 0) return true;
  return !states.every((state) => UNLISTENABLE_STATES.has(state));
}

export function toTimeline(raw: unknown): AudiotekaTrack[] {
  const tracks = embeddedOf(raw, 'app:track').flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return [];
    const index = asNumber(item.index);
    if (index === null) return [];
    return [{ id: item.id, index, durationMs: asNumber(item.duration) ?? 0 }];
  });
  tracks.sort((a, b) => a.index - b.index);
  let startMs = 0;
  return tracks.map((track) => {
    const mapped = { ...track, startMs };
    startMs += track.durationMs;
    return mapped;
  });
}

export function toRemotePosition(raw: unknown): AudiotekaRemotePosition | null {
  if (!isRecord(raw)) return null;
  const positionMs = asNumber(raw.position);
  if (positionMs === null) return null;
  return { positionMs, device: typeof raw.device === 'string' && raw.device ? raw.device : null };
}
