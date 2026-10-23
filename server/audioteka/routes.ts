import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AudiotekaHttpError, type AudiotekaClient } from './client';
import { AudiotekaSearchUnavailableError } from './search';
import type { createAudiotekaSession } from './session';

type AudiotekaSession = ReturnType<typeof createAudiotekaSession>;

declare module 'fastify' {
  interface FastifyRequest {
    audioteka: AudiotekaClient;
  }
}

const ID_PATTERN = /^[0-9a-f-]{36}$/;
const LIST_URL_PATTERN = /^(cycle|author):[\w%-]+$/;

function replyError(reply: FastifyReply, error: any) {
  if (error instanceof AudiotekaSearchUnavailableError) {
    return reply.code(503).send({ code: 'SEARCH_UNAVAILABLE' });
  }
  if (error.isAudiotekaUnauthorized) {
    return reply.code(401).send({ error: error.message });
  }
  const statusCode =
    (error instanceof AudiotekaHttpError && error.status) ||
    error.statusCode ||
    error.status ||
    500;
  return reply.code(statusCode).send({ error: error.message });
}

// Audioteka routes, all behind a logged-in Audioteka session. Registered as a
// plugin so the session is passed in rather than imported.
export function audiotekaRoutes(session: AudiotekaSession) {
  return async function register(fastify: FastifyInstance) {
    fastify.decorateRequest('audioteka', null as unknown as AudiotekaClient);

    const requireAudioteka = async (request: FastifyRequest, reply: FastifyReply) => {
      const client = session.getClient();
      if (!client) return reply.code(401).send({ error: 'Not authenticated' });
      request.audioteka = client;
    };

    const validId = (value: string, reply: FastifyReply): boolean => {
      if (ID_PATTERN.test(value)) return true;
      reply.code(400).send({ error: 'Invalid id' });
      return false;
    };

    fastify.get('/api/audioteka/library', { preHandler: requireAudioteka }, async (req, reply) => {
      try {
        reply.send(await req.audioteka.getLibrary());
      } catch (error) {
        replyError(reply, error);
      }
    });

    fastify.get<{ Params: { id: string } }>(
      '/api/audioteka/books/:id',
      { preHandler: requireAudioteka },
      async (req, reply) => {
        if (!validId(req.params.id, reply)) return;
        try {
          const [book, tracks] = await Promise.all([
            req.audioteka.getBook(req.params.id),
            req.audioteka.getTimeline(req.params.id),
          ]);
          reply.send({ book, tracks });
        } catch (error) {
          replyError(reply, error);
        }
      },
    );

    fastify.get<{ Params: { trackId: string } }>(
      '/api/audioteka/tracks/:trackId/url',
      { preHandler: requireAudioteka },
      async (req, reply) => {
        if (!validId(req.params.trackId, reply)) return;
        try {
          reply.send(await req.audioteka.getTrackUrl(req.params.trackId));
        } catch (error) {
          replyError(reply, error);
        }
      },
    );

    fastify.get<{ Params: { id: string } }>(
      '/api/audioteka/positions/:id',
      { preHandler: requireAudioteka },
      async (req, reply) => {
        if (!validId(req.params.id, reply)) return;
        try {
          reply.send(await req.audioteka.getPosition(req.params.id));
        } catch (error) {
          replyError(reply, error);
        }
      },
    );

    fastify.put<{ Params: { id: string }; Body: { position?: unknown } }>(
      '/api/audioteka/positions/:id',
      { preHandler: requireAudioteka },
      async (req, reply) => {
        if (!validId(req.params.id, reply)) return;
        const position = req.body?.position;
        if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) {
          return reply.code(400).send({ error: 'Invalid position' });
        }
        try {
          await req.audioteka.savePosition(req.params.id, position);
          reply.code(204).send();
        } catch (error) {
          replyError(reply, error);
        }
      },
    );

    fastify.post<{ Params: { id: string } }>(
      '/api/audioteka/books/:id/start',
      { preHandler: requireAudioteka },
      async (req, reply) => {
        if (!validId(req.params.id, reply)) return;
        try {
          await req.audioteka.startPlayback(req.params.id);
          reply.code(204).send();
        } catch (error) {
          replyError(reply, error);
        }
      },
    );

    fastify.get<{ Querystring: { q?: string } }>(
      '/api/audioteka/search',
      { preHandler: requireAudioteka },
      async (req, reply) => {
        const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!query) return reply.send({ results: [] });
        try {
          reply.send({ results: await req.audioteka.search(query) });
        } catch (error) {
          replyError(reply, error);
        }
      },
    );

    // One chip only: DiscoverHome shows no pills for a single chip.
    fastify.get(
      '/api/audioteka/discovery/chips',
      { preHandler: requireAudioteka },
      async (_req, reply) => {
        reply.send([{ id: 'home', label: '', pageSlug: 'home' }]);
      },
    );

    fastify.get<{ Params: { slug: string } }>(
      '/api/audioteka/discovery/page/:slug',
      { preHandler: requireAudioteka },
      async (req, reply) => {
        if (req.params.slug !== 'home') return reply.code(404).send({ error: 'Unknown page' });
        try {
          const rows = await req.audioteka.getHomeRows();
          reply.send({ title: '', rows, nextPageToken: null });
        } catch (error) {
          replyError(reply, error);
        }
      },
    );

    fastify.get<{ Querystring: { url?: string; nextPageToken?: string } }>(
      '/api/audioteka/discovery/list',
      { preHandler: requireAudioteka },
      async (req, reply) => {
        const { url, nextPageToken } = req.query;
        if (typeof url !== 'string' || !LIST_URL_PATTERN.test(url)) {
          return reply.code(400).send({ error: 'Invalid list url' });
        }
        let page = 1;
        if (nextPageToken !== undefined && nextPageToken !== '') {
          if (typeof nextPageToken !== 'string' || !/^[1-9]\d{0,5}$/.test(nextPageToken)) {
            return reply.code(400).send({ error: 'Invalid page token' });
          }
          page = Number(nextPageToken);
        }
        try {
          reply.send(await req.audioteka.getList(url, page));
        } catch (error) {
          replyError(reply, error);
        }
      },
    );

    fastify.get<{ Params: { id: string }; Querystring: { current?: string } }>(
      '/api/audioteka/discovery/series/:id',
      { preHandler: requireAudioteka },
      async (req, reply) => {
        if (!validId(req.params.id, reply)) return;
        const current = req.query.current;
        if (current !== undefined && !validId(current, reply)) return;
        try {
          const series = await req.audioteka.getSeries(req.params.id, current);
          if (!series) return reply.code(404).send({ error: 'Not a series' });
          reply.send(series);
        } catch (error) {
          replyError(reply, error);
        }
      },
    );

    fastify.get<{ Params: { id: string } }>(
      '/api/audioteka/book-details/:id',
      { preHandler: requireAudioteka },
      async (req, reply) => {
        if (!validId(req.params.id, reply)) return;
        try {
          reply.send(await req.audioteka.getBookPage(req.params.id));
        } catch (error) {
          replyError(reply, error);
        }
      },
    );

    for (const action of ['add', 'remove'] as const) {
      fastify.post<{ Body: { id?: unknown } }>(
        `/api/audioteka/library/${action}`,
        { preHandler: requireAudioteka },
        async (req, reply) => {
          const id = req.body?.id;
          if (typeof id !== 'string' || !validId(id, reply)) {
            if (typeof id !== 'string') reply.code(400).send({ error: 'Invalid id' });
            return;
          }
          try {
            if (action === 'add') await req.audioteka.addToLibrary(id);
            else await req.audioteka.removeFromLibrary(id);
            reply.send({ success: true });
          } catch (error) {
            replyError(reply, error);
          }
        },
      );
    }
  };
}
