import type { Chapter } from './chapters';

export interface BookShelfResponse {
  books: BookShelfEntity[];
  result: string;
}

export interface BookShelfEntity {
  abook: Abook;
  abookMark: AbookMark;
  book: Book;
  ebook: any;
  ebookMark: any;
  entityMetadata: any;
  id: number;
  insertDate: string;
  matchInFields: any;
  owns: number;
  restriction: number;
  shareUrl: string;
  status: number;
  subscribesToSerie: number;
  stateUpdateTime?: string;
  positionUpdatedTime?: string;
}

export interface Abook {
  allowedToStream: boolean;
  bitRate: number;
  consumableFormatId: string;
  copyright: any;
  description: string;
  display: boolean;
  edition: number;
  id: number;
  isComing: number;
  isbn: string;
  length: number;
  lengthInHHMM: string;
  narratorAsString: string;
  narrators: Narrator[];
  product: any;
  publisher: Publisher;
  releaseDate: string;
  releaseDateFormat: string;
  time: number;
}

export interface Narrator {
  description: any;
  id: number;
  language: any;
  name: string;
}

export interface Publisher {
  description: any;
  id: number;
  name: string;
}

export interface AbookMark {
  bookId: number;
  chapter: number;
  charOffsetInChapter: number;
  insertDate?: string | null;
  pos: number;
  secondsSinceCreated: number;
  type: number;
}

export interface Book {
  seriesInfo?: SeriesInfo;
  AId: number;
  EId: number;
  abridged: number;
  authors: Author[];
  authorsAsString: string;
  category: Category;
  consumableId: string;
  cover: string;
  coverE: string;
  grade: number;
  haveRead: number;
  href: any;
  id: number;
  language: Language;
  largeCover: string;
  largeCoverE: string;
  lastBookmarkTimeStamp: number;
  latestReleaseDate: string;
  lengthTime: number;
  mappingStatus: number;
  myGrade: number;
  name: string;
  nrEndBookTotal: number;
  nrEndBookWeek: number;
  nrGrade: number;
  origName: string;
  progress: number;
  season: any;
  series: Series[];
  seriesOrder: number;
  smallCover: string;
  tags: Tag[];
  translatorsAsString: string;
  type: number;
}

export interface Author {
  description: any;
  id: number;
  language: any;
  name: string;
}

export interface Category {
  countryId: number;
  description: any;
  id: number;
  nr: number;
  title: string;
  urlName: string;
}

export interface Language {
  id: number;
  isoValue: string;
  localizedName: string;
  name: string;
}

export interface Series {
  books: any;
  countryId: number;
  id: number;
  name: string;
}

export interface Tag {
  country: any;
  id: number;
  name: string;
}

export interface BookMetaData {
  title: string;
  deepLink: string;
  shareUrl: string;
  kidsBook: boolean;
  autoPlay: boolean;
  formats: Format[];
  sttMapping: SttMapping;
}

export interface Format {
  type: 'abook' | 'ebook';
  lengthInCharacters?: number;
  cover: Cover;
  durationInMilliseconds?: number;
  chapters?: Chapter[];
  takedownDate: any;
}

export interface Cover {
  url: string;
  width: number;
  height: number;
}

export interface SttMapping {
  syncedReadingEnabled: boolean;
  mappingFileUrl: string;
}

export interface SearchResultBook {
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
  // Announced but not out yet: listed, but cannot be played.
  comingSoon?: boolean;
  releaseDate?: string | null;
  language?: string;
  languageName?: string;
  seriesInfo?: SeriesInfo;
  // Authors with ids, so an author name can open the author's list.
  authorRefs?: { id: string; name: string }[];
}

export interface SeriesInfo {
  id: string;
  name: string;
  orderInSeries: number | null;
}

export interface SearchResponse {
  results: SearchResultBook[];
}

export interface DiscoveryChip {
  id: string;
  label: string;
  pageSlug: string;
}

export interface DiscoveryRow {
  id: string;
  title: string;
  items: SearchResultBook[];
  // Set for lazy rows: load the items with `getDiscoveryList`.
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
  items: SearchResultBook[];
  nextPageToken: string | null;
}

export interface DiscoverySeries {
  title: string;
  // Every part in series order, all formats; check `hasAbook` before playing.
  parts: SearchResultBook[];
  first: SearchResultBook | null;
  firstIsAudiobook: boolean;
  firstAudiobook: SearchResultBook | null;
  next: SearchResultBook | null;
}
