// Pure helpers for the Storytel explore ("Discover") endpoints: response
// mapping, URL allow-list and series part picking.

export interface SeriesInfo {
  id: string;
  name: string;
  orderInSeries: number | null;
}

export interface DiscoveryItem {
  id: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  seriesInfo: SeriesInfo | null;
  hasAbook: boolean;
  // The audiobook is announced but not out yet: listed, not playable.
  comingSoon: boolean;
  releaseDate: string | null;
  // The untouched explore item, so callers can reuse the search-hit mapper.
  raw: unknown;
}

export interface DiscoveryRow {
  id: string;
  title: string;
  items: DiscoveryItem[];
  itemsUrl: string | null;
}

export interface DiscoveryPage {
  title: string;
  rows: DiscoveryRow[];
  nextPageToken: string | null;
}

export interface DiscoveryList {
  title: string;
  totalCount: number;
  items: DiscoveryItem[];
  nextPageToken: string | null;
}

export interface DiscoveryChip {
  id: string;
  label: string;
  pageSlug: string;
}

export interface SeriesParts {
  first: DiscoveryItem | null;
  firstIsAudiobook: boolean;
  firstAudiobook: DiscoveryItem | null;
  next: DiscoveryItem | null;
  parts: DiscoveryItem[];
}

const EXPLORE_ORIGIN = 'https://api.storytel.net';

export function toSeriesInfo(raw: any): SeriesInfo | null {
  if (!raw?.id) return null;
  const order = typeof raw.orderInSeries === 'number' ? raw.orderInSeries : null;
  return { id: String(raw.id), name: String(raw.name ?? ''), orderInSeries: order };
}

export function toDiscoveryItem(raw: any): DiscoveryItem | null {
  if (!raw?.id || !raw?.title) return null;
  const formats: any[] = Array.isArray(raw.formats) ? raw.formats : [];
  // Locked content cannot be played, so it does not count as an audiobook.
  const abook = formats.find((f) => f?.type === 'abook' && f.isLockedContent !== true);
  const ebook = formats.find((f) => f?.type === 'ebook');
  return {
    id: String(raw.id),
    title: String(raw.title),
    authors: (Array.isArray(raw.authors) ? raw.authors : [])
      .map((a: any) => (typeof a === 'string' ? a : a?.name))
      .filter((name: unknown): name is string => typeof name === 'string' && name !== ''),
    coverUrl: abook?.cover?.url || ebook?.cover?.url || raw.cover?.url || null,
    seriesInfo: toSeriesInfo(raw.seriesInfo),
    hasAbook: !!abook,
    comingSoon: !!abook && abook.isReleased === false,
    releaseDate: typeof abook?.releaseDate === 'string' ? abook.releaseDate : null,
    raw,
  };
}

function toItems(rawItems: unknown): DiscoveryItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map(toDiscoveryItem).filter((item): item is DiscoveryItem => item !== null);
}

export function playableOnly(items: DiscoveryItem[]): DiscoveryItem[] {
  return items.filter((item) => item.hasAbook);
}

export function toDiscoveryPage(raw: any): DiscoveryPage {
  const rows: DiscoveryRow[] = [];
  for (const block of Array.isArray(raw?.contentBlocks) ? raw.contentBlocks : []) {
    // Banners and untitled blocks do not render as a book row.
    if (!block?.title || block.displayType === 'bannerCarousel') continue;
    if (Array.isArray(block.items)) {
      const items = playableOnly(toItems(block.items));
      if (items.length === 0) continue;
      rows.push({ id: String(block.id ?? block.title), title: block.title, items, itemsUrl: null });
    } else if (typeof block.itemsUrl === 'string' && block.itemsUrl) {
      rows.push({
        id: String(block.id ?? block.title),
        title: block.title,
        items: [],
        itemsUrl: block.itemsUrl,
      });
    }
  }
  return {
    title: typeof raw?.title === 'string' ? raw.title : '',
    rows,
    nextPageToken: raw?.nextPageToken || null,
  };
}

export function toDiscoveryList(raw: any): DiscoveryList {
  const items = toItems(raw?.items);
  return {
    title: typeof raw?.title === 'string' ? raw.title : '',
    totalCount: typeof raw?.totalCount === 'number' ? raw.totalCount : items.length,
    items,
    nextPageToken: raw?.nextPageToken || null,
  };
}

// Only explore endpoints on Storytel's API host may be fetched on behalf of
// the renderer.
export function isAllowedExploreUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (/%2f|%5c|%2e/i.test(parsed.pathname)) return false;
  return parsed.origin === EXPLORE_ORIGIN && parsed.pathname.startsWith('/explore/');
}

function byOrder(a: DiscoveryItem, b: DiscoveryItem): number {
  const ao = a.seriesInfo?.orderInSeries ?? null;
  const bo = b.seriesInfo?.orderInSeries ?? null;
  if (ao === bo) return 0;
  if (ao === null) return 1;
  if (bo === null) return -1;
  return ao - bo;
}

// Part 1 is the lowest numbered part of any format; when it is not an
// audiobook, `firstAudiobook` is the lowest-ordered audiobook instead. Null
// orders go last and ties keep API order (Array#sort is stable).
export function pickSeriesParts(items: DiscoveryItem[], currentOrder: number | null): SeriesParts {
  const parts = [...items].sort(byOrder);
  const lead = parts[0];
  const leadOrder = lead?.seriesInfo?.orderInSeries ?? null;
  // Among parts tied at the lowest order, prefer an audiobook.
  const first =
    leadOrder === null
      ? null
      : (parts.find((part) => part.seriesInfo?.orderInSeries === leadOrder && part.hasAbook) ??
        lead);
  // Coming-soon parts are listed but cannot be played yet.
  const playable = (part: DiscoveryItem) => part.hasAbook && !part.comingSoon;
  const firstAudiobook = parts.find(playable) ?? null;
  const next =
    currentOrder === null
      ? null
      : (parts.find(
          (part) =>
            playable(part) &&
            part.seriesInfo?.orderInSeries != null &&
            part.seriesInfo.orderInSeries > currentOrder,
        ) ?? null);
  return { first, firstIsAudiobook: !!first?.hasAbook, firstAudiobook, next, parts };
}
