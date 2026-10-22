import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import StorytelClient, { type BookShelfEntity, mapCatalogItem } from './storytelApi';
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { type DiscoveryItem, isAllowedExploreUrl, pickSeriesParts } from './discovery';
import { downloadToFile } from './download';
import { createDownloadsIndex } from './downloadsIndex';
import type { FetchLike } from './http/storytelFetch';
import { appLogger } from './logger';
import { AudiotekaClient } from './audioteka/client';
import { audiotekaRoutes } from './audioteka/routes';
import { type AudiotekaAuthApi, createAudiotekaSession } from './audioteka/session';
import { type AuthApi, createSession } from './session';

// Routes behind requireSession get the session's shared Storytel client.
declare module 'fastify' {
  interface FastifyRequest {
    storytel: StorytelClient;
  }
}

dotenv.config({
  quiet: true,
});

// Sends 401 when the Storytel session expired, or appropriate status code for other errors.
function replyError(reply: FastifyReply, error: any) {
  if (error.isStorytelUnauthorized) {
    return reply.code(401).send({ error: error.message });
  }
  const statusCode =
    error.status || error.statusCode || (error.response && error.response.status) || 500;
  return reply.code(statusCode).send({ error: error.message });
}

const DOWNLOADS_DIR = process.env.IS_ELECTRON
  ? '' + process.env.DOWNLOAD_PATH
  : path.join(__dirname, 'downloads');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Downloaded files are named "<title> [<bookId>].mp3" so they are recognizable
// in a file manager. The bookId suffix stays the lookup key, because most
// routes only know the bookId. Older downloads are named "<bookId>.mp3" and
// are still found by findDownloadedFile.
const MAX_TITLE_LENGTH = 120;

function isValidBookId(bookId: unknown): bookId is string {
  return typeof bookId === 'string' && /^\d+$/.test(bookId);
}

function sanitizeFileTitle(title: string): string {
  return title
    .replace(/[<>:"/\\|?*#%\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .replace(/[. ]+$/, ''); // Windows rejects trailing dots and spaces
}

function buildDownloadPath(bookId: string, title?: string): string {
  const safeTitle = title ? sanitizeFileTitle(title) : '';
  const fileName = safeTitle ? `${safeTitle} [${bookId}].mp3` : `${bookId}.mp3`;
  return path.join(DOWNLOADS_DIR, fileName);
}

function findDownloadedFile(bookId: string): string | null {
  if (!isValidBookId(bookId)) return null;

  const legacyPath = path.join(DOWNLOADS_DIR, `${bookId}.mp3`);
  if (fs.existsSync(legacyPath)) return legacyPath;

  const suffix = ` [${bookId}].mp3`;
  const match = fs.readdirSync(DOWNLOADS_DIR).find((name) => name.endsWith(suffix));
  return match ? path.join(DOWNLOADS_DIR, match) : null;
}

// Used by the Electron main process to serve downloaded books over its media
// protocol; returns null for anything that is not a downloaded book id.
export function resolveDownloadedFile(bookId: string): string | null {
  return findDownloadedFile(bookId);
}

// Bookshelf entries of downloaded books, so the library can be listed offline.
// Entries come from Storytel's bookshelf or from the client at download time.
const downloadsIndex = createDownloadsIndex<BookShelfEntity>(
  path.join(process.env.USER_DATA_PATH || process.cwd(), 'downloads-index.json'),
);

// The id the client routes and downloads by: the audiobook format id, falling
// back to the bookshelf entry id (see Dashboard's handleQuickPlay).
function downloadKeyOf(entry: BookShelfEntity): string {
  return String(entry.abook?.id || entry.id);
}

function isShelfEntry(value: unknown): value is BookShelfEntity {
  return (
    !!value &&
    typeof value === 'object' &&
    !!(value as BookShelfEntity).book &&
    typeof (value as BookShelfEntity).book === 'object'
  );
}

// Refreshes the index from a fresh bookshelf: keeps status and position of
// downloaded books current, and indexes books downloaded before the index
// existed. Never fails the bookshelf request.
function backfillDownloadsIndex(books: BookShelfEntity[]) {
  try {
    for (const entry of books) {
      const bookId = downloadKeyOf(entry);
      if (findDownloadedFile(bookId)) downloadsIndex.upsert(bookId, entry);
    }
  } catch (error) {
    fastify.log.warn(`Could not update the downloads index: ${(error as Error).message}`);
  }
}

const activeDownloads = new Map<
  string,
  {
    controller: AbortController;
  }
>();

const fastify = Fastify({ logger: process.env.NODE_ENV !== 'production' });

// Fetch used by the session's Storytel client; only tests replace it.
let sessionFetch: FetchLike | undefined;

// Test seam: routes.test.ts injects a fetch stub here before restoring a
// session. Takes effect for clients created afterwards (login/restore).
export function configureSessionForTests(options: { fetch?: FetchLike }): void {
  sessionFetch = options.fetch;
}

// The logged-in account. The Electron main process drives it in-process
// through `auth`; there is no login route, so the renderer cannot reach it.
const session = createSession((opts) => new StorytelClient({ ...opts, fetch: sessionFetch }));

export const auth: AuthApi = session;

// Fetch used by the Audioteka client; only tests replace it.
let audiotekaFetch: FetchLike | undefined;

export function configureAudiotekaForTests(options: { fetch?: FetchLike }): void {
  audiotekaFetch = options.fetch;
}

// The logged-in Audioteka account, driven by the main process like `auth`.
const audiotekaSession = createAudiotekaSession(
  (opts) => new AudiotekaClient({ ...opts, fetch: audiotekaFetch }),
);

export const audiotekaAuth: AudiotekaAuthApi = audiotekaSession;

fastify.decorateRequest('storytel', null as unknown as StorytelClient);

// Requires a session (stored credentials), never a live Storytel token: routes
// serving local data keep working offline, and Storytel calls log in lazily.
async function requireSession(request: FastifyRequest, reply: FastifyReply) {
  const client = session.getClient();
  if (!client) {
    return reply.code(401).send({ error: 'Not authenticated' });
  }
  request.storytel = client;
}

// Route per ottenere bookshelf
fastify.get(
  '/api/bookshelf',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const storytelClient = request.storytel;

      const bookshelf = await storytelClient.getBookshelf();
      backfillDownloadsIndex(bookshelf.books);
      reply.send(bookshelf);
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

// Books downloaded to this computer, for the library while Storytel is
// unreachable. Same shape as /api/bookshelf; makes no Storytel call.
fastify.get(
  '/api/offline/bookshelf',
  {
    preHandler: requireSession,
  },
  async (_request, reply) => {
    try {
      const books = downloadsIndex
        .list()
        .filter(({ bookId, entry }) => isShelfEntry(entry) && findDownloadedFile(bookId))
        .map(({ entry }) => entry);
      reply.send({ books });
    } catch (error) {
      replyError(reply, error);
    }
  },
);

// Route to search Storytel catalog
fastify.get<{
  Querystring: { q?: string; query?: string };
}>(
  '/api/search',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const q = request.query.q || request.query.query || '';
      if (!q.trim()) {
        return reply.send({ results: [] });
      }

      const storytelClient = request.storytel;
      const results = await storytelClient.searchCatalog(q);
      reply.send({ results });
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

// --- Discovery (Storytel explore) --------------------------------------------

const mapItems = (items: DiscoveryItem[]) => items.map(mapCatalogItem);

fastify.get('/api/discovery/chips', { preHandler: requireSession }, async (request, reply) => {
  try {
    reply.send(await request.storytel.getExploreChips());
  } catch (error: any) {
    replyError(reply, error);
  }
});

fastify.get<{
  Params: { slug: string };
  Querystring: { nextPageToken?: string };
}>('/api/discovery/page/:slug', { preHandler: requireSession }, async (request, reply) => {
  if (!/^[\w-]+$/.test(request.params.slug)) {
    return reply.code(400).send({ error: 'Invalid page slug' });
  }
  try {
    const page = await request.storytel.getExplorePage(
      request.params.slug,
      request.query.nextPageToken || undefined,
    );
    reply.send({
      title: page.title,
      rows: page.rows.map((row) => ({
        id: row.id,
        title: row.title,
        items: mapItems(row.items),
        itemsUrl: row.itemsUrl,
      })),
      nextPageToken: page.nextPageToken,
    });
  } catch (error: any) {
    replyError(reply, error);
  }
});

fastify.get<{
  Querystring: { url?: string; nextPageToken?: string };
}>('/api/discovery/list', { preHandler: requireSession }, async (request, reply) => {
  try {
    const { url, nextPageToken } = request.query;
    if (!url || !isAllowedExploreUrl(url)) {
      return reply.code(400).send({ error: 'Invalid list url' });
    }
    const list = await request.storytel.getExploreList(url, nextPageToken || undefined);
    reply.send({
      title: list.title,
      totalCount: list.totalCount,
      items: mapItems(list.items),
      nextPageToken: list.nextPageToken,
    });
  } catch (error: any) {
    replyError(reply, error);
  }
});

fastify.get<{
  Params: { id: string };
  Querystring: { current?: string };
}>('/api/discovery/series/:id', { preHandler: requireSession }, async (request, reply) => {
  if (!/^\d+$/.test(request.params.id)) {
    return reply.code(400).send({ error: 'Invalid series id' });
  }
  try {
    const current = request.query.current;
    const currentOrder = current !== undefined && current !== '' ? Number(current) : null;
    const series = await request.storytel.getSeries(request.params.id);
    const picked = pickSeriesParts(
      series.items,
      currentOrder !== null && Number.isFinite(currentOrder) ? currentOrder : null,
    );
    const one = (item: DiscoveryItem | null) => (item ? mapCatalogItem(item) : null);
    reply.send({
      title: series.title,
      parts: mapItems(picked.parts),
      first: one(picked.first),
      firstIsAudiobook: picked.firstIsAudiobook,
      firstAudiobook: one(picked.firstAudiobook),
      next: one(picked.next),
    });
  } catch (error: any) {
    replyError(reply, error);
  }
});

// Route to add book to bookshelf
fastify.post<{
  Body: { consumableId: string };
}>(
  '/api/bookshelf/add',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { consumableId } = request.body;
      if (!consumableId) {
        return reply.code(400).send({ error: 'Missing consumableId' });
      }

      const storytelClient = request.storytel;
      const result = await storytelClient.addToBookshelf(consumableId);

      // The Storytel endpoint answers 200 even when it ignores the write, so
      // only report success once the book was seen on the bookshelf.
      if (!result.added) {
        return reply.code(502).send({
          code: 'ADD_TO_BOOKSHELF_NOT_CONFIRMED',
          error: 'Storytel accepted the request but the book is not on the bookshelf',
        });
      }

      reply.send({ success: true, result });
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

// Route to remove a book from the bookshelf
fastify.post<{
  Body: { consumableId: string };
}>(
  '/api/bookshelf/remove',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { consumableId } = request.body;
      if (!consumableId) {
        return reply.code(400).send({ error: 'Missing consumableId' });
      }

      const storytelClient = request.storytel;
      const result = await storytelClient.removeFromBookshelf(consumableId);

      // Same contract as /bookshelf/add: Storytel answers 200 even when it
      // ignores the write, so only report success once the book is really gone.
      if (!result.removed) {
        return reply.code(502).send({
          code: 'REMOVE_FROM_BOOKSHELF_NOT_CONFIRMED',
          error: 'Storytel accepted the request but the book is still on the bookshelf',
        });
      }

      reply.send({ success: true, result });
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

// Route per ottenere stream URL
fastify.post<{
  Body: { bookId: string; consumableId?: string };
}>(
  '/api/stream',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { bookId, consumableId } = request.body;
      const localFilePath = findDownloadedFile(bookId);

      // Check if file exists locally
      if (localFilePath) {
        // Served by the Electron main process (src/modules/mediaProtocol.ts):
        // a file:// URL is refused by Chromium when the page is http://.
        reply.send({ streamUrl: `bookwave-media://book/${bookId}`, remote: false });
      } else {
        const storytelClient = request.storytel;
        // Prefer the new api.storytel.net assets endpoint (needs consumableId);
        // fall back to the legacy programId-based stream if not provided.
        const streamUrl = consumableId
          ? await storytelClient.getAudioStreamUrl(consumableId)
          : await storytelClient.getStreamUrl(bookId);
        reply.send({ streamUrl, remote: true });
      }
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

// Route per salvare bookmark
fastify.post<{
  Params: { consumableId: string };
  Body: { position: number; note: string };
}>(
  '/api/bookmarks/:consumableId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { consumableId } = request.params;
      const { position, note } = request.body;

      const storytelClient = request.storytel;

      await storytelClient.setBookmark(consumableId, position, note);

      reply.send({ success: true, message: 'Bookmark saved' });
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

fastify.delete<{
  Params: { consumableId: string; bookmarkId: string };
}>(
  '/api/bookmarks/:consumableId/:bookmarkId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { consumableId, bookmarkId } = request.params;
      const storytelClient = request.storytel;

      await storytelClient.deleteBookmark(consumableId, bookmarkId);

      reply.send({ success: true, message: 'Bookmark removed' });
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

fastify.put<{
  Params: { consumableId: string; bookmarkId: string };
  Body: any;
}>(
  '/api/bookmarks/:consumableId/:bookmarkId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { consumableId, bookmarkId } = request.params;
      const storytelClient = request.storytel;

      await storytelClient.updateBookmark(consumableId, bookmarkId, request.body);

      reply.send({ success: true, message: 'Bookmark removed' });
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

fastify.get(
  '/api/bookmark-positional',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const storytelClient = request.storytel;

      const bookmarks = await storytelClient.getBookmarkPositional();
      reply.send(bookmarks);
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

fastify.get<{
  Params: { consumableId: string };
}>(
  '/api/bookmark-positional/:consumableId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { consumableId } = request.params;

      const storytelClient = request.storytel;

      const bookmarks = await storytelClient.getBookmarkPositional(consumableId);
      reply.send(bookmarks);
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

fastify.put<{
  Params: { consumableId: string };
  Body: { position: number };
}>(
  '/api/bookmark-positional/:consumableId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { consumableId } = request.params;
      const { position } = request.body;

      const storytelClient = request.storytel;

      const deviceId = process.env.DEVICE_ID || crypto.randomUUID().toUpperCase();
      const updated = await storytelClient.updateBookmarkPositional(
        consumableId,
        position,
        deviceId,
      );
      reply.send(updated);
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

fastify.get<{
  Params: { consumableId: string };
}>(
  '/api/bookmarks/:consumableId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { consumableId } = request.params;
      const storytelClient = request.storytel;

      const bookmarks = await storytelClient.getBookmark(consumableId);
      reply.send(bookmarks);
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

fastify.get<{
  Params: { consumableId: string };
}>(
  '/api/bookmetadata/:consumableId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { consumableId } = request.params;
      const storytelClient = request.storytel;
      const bookInfoContent = await storytelClient.getPlayBookMetaData(consumableId);
      reply.send(bookInfoContent);
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

fastify.get<{
  Params: { consumableId: string };
}>(
  '/api/book-details/:consumableId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { consumableId } = request.params;
      if (!isValidBookId(consumableId)) {
        return reply.code(400).send({ error: 'Invalid consumableId' });
      }
      const storytelClient = request.storytel;
      const details = await storytelClient.getBookDetails(consumableId);
      reply.send(details);
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

// Locale loaders keyed by language code. The import paths are written out
// literally so esbuild can bundle every locale into the server build - a
// computed `import("./locales/" + code)` is not resolvable at build time.
//
// Adding a language? Add the JSON file here and mirror it in
// `client/src/config/languages.ts` and `src/i18n/languages.ts`.
const LOCALE_LOADERS = {
  de: () => import('./locales/de.json'),
  en: () => import('./locales/en.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  it: () => import('./locales/it.json'),
  pl: () => import('./locales/pl.json'),
  fi: () => import('./locales/fi.json'),
  sv: () => import('./locales/sv.json'),
} as const;

type SupportedLanguage = keyof typeof LOCALE_LOADERS;

const SUPPORTED_LANGUAGES = Object.keys(LOCALE_LOADERS) as SupportedLanguage[];

const loadLocale = async (code: SupportedLanguage) => (await LOCALE_LOADERS[code]()).default;

fastify.get<{
  Querystring: { lang?: string };
}>('/api/translations', async (request, reply) => {
  try {
    const { lang } = request.query;

    // Accept region variants and odd casing ("sv-FI", "SV", "sv_FI" -> "sv").
    // Without this a locale like sv-FI fell through to the "every language"
    // branch below, which i18next then loaded as a single unusable bundle.
    const requested = (lang ?? '').trim().toLowerCase().replace(/_/g, '-');
    const base = requested.split('-')[0];
    const match = SUPPORTED_LANGUAGES.find((code) => code === requested || code === base);

    if (match) {
      const translations = await loadLocale(match);
      reply.header('Content-Language', match);
      reply.send(translations);
    } else {
      // No usable `lang`: hand back every bundle, keyed by language code.
      const bundles = await Promise.all(
        SUPPORTED_LANGUAGES.map(async (code) => [code, await loadLocale(code)] as const),
      );
      reply.send(Object.fromEntries(bundles));
    }
  } catch (error: any) {
    reply.code(500).send({ error: 'Failed to load translations' });
  }
});

// Route per scaricare il file audio da remoto
fastify.post<{
  Body: {
    bookId: string;
    consumableId?: string;
    // The bookshelf entry the player shows; indexed for the offline library.
    book?: BookShelfEntity;
  };
}>(
  '/api/download',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { bookId, consumableId, book } = request.body;

      if (!isValidBookId(bookId)) {
        return reply.code(400).send({ error: 'Invalid bookId' });
      }

      const indexDownload = () => {
        if (!isShelfEntry(book)) return;
        // Never file one book's entry under another book's download.
        if (downloadKeyOf(book) !== bookId) {
          fastify.log.warn(
            `Not indexing download ${bookId}: entry belongs to ${downloadKeyOf(book)}`,
          );
          return;
        }
        try {
          downloadsIndex.upsert(bookId, book);
        } catch (error) {
          fastify.log.warn(`Could not index download ${bookId}: ${(error as Error).message}`);
        }
      };

      // Check if already exists
      if (findDownloadedFile(bookId)) {
        indexDownload();
        return reply.send({
          success: true,
          message: 'File already downloaded',
          percentage: 100,
        });
      }

      if (activeDownloads.has(bookId)) {
        return reply.code(409).send({ error: 'Download already in progress' });
      }

      // Get stream URL
      const storytelClient = request.storytel;
      // Prefer the new api.storytel.net assets endpoint (needs consumableId);
      // fall back to the legacy programId-based stream if not provided.
      const streamUrl = consumableId
        ? await storytelClient.getAudioStreamUrl(consumableId)
        : await storytelClient.getStreamUrl(bookId);

      // Download to a temporary file and rename it on completion, so a
      // partial download is never picked up by findDownloadedFile.
      const localFilePath = buildDownloadPath(bookId, book?.book?.name);

      // Create AbortController for this download
      const controller = new AbortController();

      // Track this download
      activeDownloads.set(bookId, { controller });
      // A cancel removes the entry at once and a new download of the same
      // book may already own it; only remove the entry if it is still ours.
      const untrack = () => {
        if (activeDownloads.get(bookId)?.controller === controller) {
          activeDownloads.delete(bookId);
        }
      };

      try {
        let lastLoggedStep = -1;
        await downloadToFile({
          url: streamUrl,
          filePath: localFilePath,
          signal: controller.signal,
          onProgress: (received, total) => {
            const percentage = total ? Math.round((received / total) * 100) : 0;
            const step = Math.floor(percentage / 10);
            if (step !== lastLoggedStep) {
              lastLoggedStep = step;
              fastify.log.info(`Download progress for ${bookId}: ${percentage}%`);
            }
          },
        });

        untrack();
        indexDownload();

        reply.send({
          success: true,
          message: 'Download completed',
          percentage: 100,
        });
      } catch (error: any) {
        untrack();

        // downloadToFile already removed the partial file
        if (controller.signal.aborted) {
          reply.code(499).send({ error: 'Download cancelled' });
        } else {
          throw error;
        }
      }
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

// Route per cancellare download in corso
fastify.delete<{
  Params: { bookId: string };
}>(
  '/api/download/:bookId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { bookId } = request.params;

      const download = activeDownloads.get(bookId);
      if (!download) {
        return reply.send({ error: 'No active download found' });
      }

      // Abort the download; downloadToFile removes the .part file itself and
      // the download route replies 499 to its own client.
      download.controller.abort();

      // Clean up
      activeDownloads.delete(bookId);

      reply.send({ success: true, message: 'Download cancelled' });
    } catch (error: any) {
      console.error('Error cancelling download:', error);
      replyError(reply, error);
    }
  },
);

fastify.get<{
  Params: { bookId: string };
}>(
  '/api/download/:bookId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { bookId } = request.params;
      const localFilePath = findDownloadedFile(bookId);

      if (!localFilePath) {
        return reply.code(404).send({ error: 'File not found' });
      }

      const stream = fs.createReadStream(localFilePath);
      reply.type('audio/mpeg').send(stream);
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

// Route per verificare lo stato del download
fastify.get<{
  Params: { bookId: string };
}>(
  '/api/download-status/:bookId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { bookId } = request.params;
      reply.send({ downloaded: findDownloadedFile(bookId) !== null });
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

// Route per eliminare file scaricato
fastify.delete<{
  Params: { bookId: string };
}>(
  '/api/downloaded-file/:bookId',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    try {
      const { bookId } = request.params;
      const localFilePath = findDownloadedFile(bookId);

      if (!localFilePath) {
        return reply.code(404).send({ error: 'File not found' });
      }

      // Delete the file
      fs.unlinkSync(localFilePath);
      try {
        downloadsIndex.remove(bookId);
      } catch (error) {
        // The offline list skips books without a file, so a stale entry is harmless.
        fastify.log.warn(`Could not unindex download ${bookId}: ${(error as Error).message}`);
      }

      reply.send({ success: true, message: 'File deleted successfully' });
    } catch (error: any) {
      replyError(reply, error);
    }
  },
);

fastify.get(
  '/api/logs',
  {
    preHandler: requireSession,
  },
  async (_request, reply) => {
    reply.send(appLogger.getLogs());
  },
);

fastify.delete(
  '/api/logs',
  {
    preHandler: requireSession,
  },
  async (_request, reply) => {
    appLogger.clearLogs();
    reply.send({ success: true });
  },
);

fastify.post<{ Body: { message: string; data?: any } }>(
  '/api/logs/action',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    appLogger.add({
      type: 'action',
      message: request.body.message,
      data: request.body.data,
    });
    reply.send({ success: true });
  },
);

fastify.register(audiotekaRoutes(audiotekaSession));

export default fastify;
