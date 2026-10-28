import crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'fs';
import path from 'path';
import StorytelClient, { type BookShelfEntity, mapCatalogItem } from './client';
import { type DiscoveryItem, isAllowedExploreUrl, pickSeriesParts } from './discovery';
import { downloadToFile } from './download';
import { createDownloadsIndex } from './downloadsIndex';
import { remoteMovedSince } from '../positionGuard';
import type { createSession } from './session';

type StorytelSession = ReturnType<typeof createSession>;

// Routes behind requireSession get the session's shared Storytel client.
declare module 'fastify' {
  interface FastifyRequest {
    storytel: StorytelClient;
  }
}

// Sends 401 when the Storytel session expired, or appropriate status code for other errors.
function replyError(reply: FastifyReply, error: any) {
  if (error.isStorytelUnauthorized) {
    return reply.code(401).send({ error: error.message });
  }
  const statusCode =
    error.status || error.statusCode || (error.response && error.response.status) || 500;
  return reply.code(statusCode).send({ error: error.message });
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

// Downloaded books on this computer: the files in `downloadsDir` and the index
// at `indexPath`. Creates the downloads directory if it does not exist yet.
export function createStorytelDownloads(downloadsDir: string, indexPath: string) {
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  function buildDownloadPath(bookId: string, title?: string): string {
    const safeTitle = title ? sanitizeFileTitle(title) : '';
    const fileName = safeTitle ? `${safeTitle} [${bookId}].mp3` : `${bookId}.mp3`;
    return path.join(downloadsDir, fileName);
  }

  function findDownloadedFile(bookId: string): string | null {
    if (!isValidBookId(bookId)) return null;

    const legacyPath = path.join(downloadsDir, `${bookId}.mp3`);
    if (fs.existsSync(legacyPath)) return legacyPath;

    const suffix = ` [${bookId}].mp3`;
    const match = fs.readdirSync(downloadsDir).find((name) => name.endsWith(suffix));
    return match ? path.join(downloadsDir, match) : null;
  }

  // Bookshelf entries of downloaded books, so the library can be listed offline.
  // Entries come from Storytel's bookshelf or from the client at download time.
  const index = createDownloadsIndex<BookShelfEntity>(indexPath);

  return { buildDownloadPath, findDownloadedFile, index };
}

export type StorytelDownloads = ReturnType<typeof createStorytelDownloads>;

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

// Requires a session (stored credentials), never a live Storytel token: routes
// serving local data keep working offline, and Storytel calls log in lazily.
export function requireStorytelSession(session: StorytelSession) {
  return async function requireSession(request: FastifyRequest, reply: FastifyReply) {
    const client = session.getClient();
    if (!client) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }
    request.storytel = client;
  };
}

// Storytel routes, all behind a Storytel session. Registered as a plugin so the
// session and the downloads are passed in rather than imported.
export function storytelRoutes(session: StorytelSession, downloads: StorytelDownloads) {
  return async function register(fastify: FastifyInstance) {
    fastify.decorateRequest('storytel', null as unknown as StorytelClient);

    const requireSession = requireStorytelSession(session);
    const { buildDownloadPath, findDownloadedFile, index: downloadsIndex } = downloads;

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
      Body: { position: number; ifRemoteAt?: number };
    }>(
      '/api/bookmark-positional/:consumableId',
      {
        preHandler: requireSession,
      },
      async (request, reply) => {
        try {
          const { consumableId } = request.params;
          const { position, ifRemoteAt } = request.body;

          const storytelClient = request.storytel;

          // A guarded write reads the position first, in this one request, so
          // a quit (which waits only for running requests) still covers both.
          if (ifRemoteAt !== undefined) {
            const bookmarks = await storytelClient.getBookmarkPositional(consumableId);
            const current = bookmarks?.find((entry) => entry.type === 'abook')?.position;
            if (remoteMovedSince(current, ifRemoteAt)) {
              return reply.send({ skipped: true });
            }
          }

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
  };
}
