// Pure mappers from Audioteka catalogue responses (products, home screen
// sections, cycles) to the discovery shapes the renderer already uses for
// Storytel. Field-for-field copies of `client/src/interfaces/books.ts`.
//
// Club only: rows, lists, search hits and recommendations keep products that
// are audiobooks available in the Audioteka Club subscription.

export interface SeriesInfo {
  id: string;
  name: string;
  orderInSeries: number | null;
}

export interface AuthorRef {
  id: string;
  name: string;
}

export interface CatalogBook {
  id: string;
  title: string;
  authors: string;
  narrators: string;
  coverUrl: string;
  category: string;
  durationMs: number;
  description?: string;
  hasAbook: boolean;
  hasEbook: boolean;
  comingSoon?: boolean;
  releaseDate?: string | null;
  language?: string;
  languageName?: string;
  seriesInfo?: SeriesInfo;
  authorRefs?: AuthorRef[];
}

export interface DiscoveryRow {
  id: string;
  title: string;
  items: CatalogBook[];
  itemsUrl: string | null;
}

export interface DiscoveryList {
  title: string;
  totalCount: number;
  items: CatalogBook[];
  nextPageToken: string | null;
}

export interface DiscoverySeries {
  title: string;
  parts: CatalogBook[];
  first: CatalogBook | null;
  firstIsAudiobook: boolean;
  firstAudiobook: CatalogBook | null;
  next: CatalogBook | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

export const embeddedList = (raw: unknown, rel: string): unknown[] => {
  if (!isRecord(raw) || !isRecord(raw._embedded)) return [];
  const items = raw._embedded[rel];
  return Array.isArray(items) ? items : [];
};

// Search hits and list items carry `[{id, value}]`; an audiobook detail
// embeds full `{id, name}` entities instead.
const refs = (raw: Record<string, unknown>, field: string, rel: string): AuthorRef[] => {
  const direct = raw[field];
  const [items, key] = Array.isArray(direct) ? [direct, 'value'] : [embeddedList(raw, rel), 'name'];
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = nonEmpty(item[key]);
    if (!name) return [];
    return [{ id: typeof item.id === 'string' ? item.id : '', name }];
  });
};

const firstCategory = (raw: Record<string, unknown>): string => {
  const direct = raw.categories;
  if (Array.isArray(direct) && direct.length > 0) {
    const first = direct[0];
    return (isRecord(first) && nonEmpty(first.value)) || '';
  }
  const embedded = embeddedList(raw, 'app:category')[0];
  return (isRecord(embedded) && nonEmpty(embedded.name)) || '';
};

// A playable title: not a cycle (series or collection) and not a podcast.
const isAudiobook = (raw: Record<string, unknown>): boolean => {
  if (raw.cycle_type !== null && raw.cycle_type !== undefined) return false;
  return !(typeof raw.kind === 'string' && /podcast/i.test(raw.kind));
};

// Maps any audiobook product; `hasAbook` says whether the Club covers it.
export function toProductBook(product: unknown): CatalogBook | null {
  if (!isRecord(product) || !isAudiobook(product)) return null;
  const id = nonEmpty(product.id);
  if (!id || typeof product.name !== 'string') return null;
  const authorRefs = refs(product, 'authors', 'app:author');
  const book: CatalogBook = {
    id,
    title: product.name,
    authors: authorRefs.map((ref) => ref.name).join(', '),
    authorRefs,
    narrators: refs(product, 'lectors', 'app:lector')
      .map((ref) => ref.name)
      .join(', '),
    coverUrl: nonEmpty(product.image_url) ?? '',
    category: firstCategory(product),
    durationMs:
      typeof product.tracks_duration_in_ms === 'number' &&
      Number.isFinite(product.tracks_duration_in_ms)
        ? product.tracks_duration_in_ms
        : 0,
    hasAbook: product.is_available_in_subscription === true,
    hasEbook: false,
  };
  const language = nonEmpty(product.content_language);
  if (language) book.language = language;
  return book;
}

// Club audiobooks only; everything else (bought-only titles, podcasts,
// cycles) maps to null.
export function toCatalogBook(product: unknown): CatalogBook | null {
  const book = toProductBook(product);
  return book?.hasAbook ? book : null;
}

export const toCatalogBooks = (products: unknown[]): CatalogBook[] =>
  products.flatMap((product) => {
    const book = toCatalogBook(product);
    return book ? [book] : [];
  });

// Home rows are the `product-grid` sections of `/v2/me/screen`. Their section
// endpoint only repeats the same items, so a row has no "see all" list.
export function toHomeRows(screen: unknown): DiscoveryRow[] {
  return embeddedList(screen, 'app:screen-section').flatMap((section) => {
    if (!isRecord(section) || section.type !== 'product-grid') return [];
    const id = nonEmpty(section.id);
    if (!id) return [];
    const items = toCatalogBooks(embeddedList(section, 'app:product'));
    if (items.length === 0) return [];
    return [{ id, title: nonEmpty(section.title) ?? '', items, itemsUrl: null }];
  });
}

// Only `series` cycles are ordered; `generic` cycles are editorial
// collections (even "Wiedźmin"). The cycle's product list is in series order.
export function toSeries(
  cycle: unknown,
  products: unknown[],
  currentId?: string,
): DiscoverySeries | null {
  if (!isRecord(cycle) || cycle.cycle_type !== 'series') return null;
  const seriesId = nonEmpty(cycle.id) ?? '';
  const name = nonEmpty(cycle.name) ?? '';
  const parts = products.flatMap((product, index) => {
    const book = toProductBook(product);
    if (!book) return [];
    book.seriesInfo = { id: seriesId, name, orderInSeries: index + 1 };
    return [book];
  });
  const first = parts[0] ?? null;
  const currentIndex = currentId ? parts.findIndex((part) => part.id === currentId) : -1;
  const next =
    currentIndex === -1
      ? null
      : (parts.slice(currentIndex + 1).find((part) => part.hasAbook) ?? null);
  return {
    title: name,
    parts,
    first,
    firstIsAudiobook: !!first?.hasAbook,
    firstAudiobook: parts.find((part) => part.hasAbook) ?? null,
    next,
  };
}
