import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AudiotekaHttpError, type AudiotekaClient } from './client';
import type { createAudiotekaSession } from './session';

type AudiotekaSession = ReturnType<typeof createAudiotekaSession>;

declare module 'fastify' {
  interface FastifyRequest {
    audioteka: AudiotekaClient;
  }
}

const ID_PATTERN = /^[0-9a-f-]{36}$/;

function replyError(reply: FastifyReply, error: any) {
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
  };
}
