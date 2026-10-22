import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FetchLike } from '../http/storytelFetch';

// fastify-common reads env and creates directories at import time (see
// server/routes.test.ts); restore the variables afterwards.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookwave-audioteka-routes-'));
const testEnv = {
  IS_ELECTRON: 'true',
  DOWNLOAD_PATH: tmpDir,
  USER_DATA_PATH: tmpDir,
  NODE_ENV: 'production',
};
const savedEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));
Object.assign(process.env, testEnv);

const {
  default: fastify,
  audiotekaAuth,
  configureAudiotekaForTests,
} = await import('../fastify-common');

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterAll(() => {
  audiotekaAuth.logout();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ID = '0a1b2c3d-0000-4000-8000-0123456789ab';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Seen {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function useFetch(handler: (seen: Seen) => Response) {
  const calls: Seen[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const seen: Seen = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.push(seen);
    if (seen.path === '/v2/apps/config/android') {
      return json({ app_version_config: { current_version: '3.60.1' } });
    }
    return handler(seen);
  };
  configureAudiotekaForTests({ fetch: fetchImpl });
  return calls;
}

function login() {
  audiotekaAuth.restore({
    deviceId: 'd',
    refreshId: 'r',
    token: 't',
    expiresAt: '2099-01-01T00:00:00+00:00',
  });
}

describe('Audioteka routes', () => {
  test('401 without a session', async () => {
    audiotekaAuth.logout();
    const res = await fastify.inject({ method: 'GET', url: '/api/audioteka/library' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Not authenticated' });
  });

  test('400 for ids that are not uuids', async () => {
    useFetch(() => json({}));
    login();
    for (const url of [
      '/api/audioteka/books/not-a-uuid',
      '/api/audioteka/tracks/not-a-uuid/url',
      '/api/audioteka/positions/not-a-uuid',
    ]) {
      const res = await fastify.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
    }
  });

  test('library returns merged entries', async () => {
    useFetch(({ path: p }) => {
      if (p === '/v2/me/shelf') {
        return json({
          _embedded: {
            'app:audiobook': [{ id: ID, name: 'Lalka', duration_in_seconds: 60 }],
          },
        });
      }
      if (p.startsWith('/v2/me/audiobook-license-channels/')) return json({});
      return json({});
    });
    login();
    const res = await fastify.inject({ method: 'GET', url: '/api/audioteka/library' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  test('PUT position rejects a non-numeric body', async () => {
    const calls = useFetch(() => json({}));
    login();
    const res = await fastify.inject({
      method: 'PUT',
      url: `/api/audioteka/positions/${ID}`,
      payload: { position: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('PUT position saves and answers 204', async () => {
    const calls = useFetch(() => json({}));
    login();
    const res = await fastify.inject({
      method: 'PUT',
      url: `/api/audioteka/positions/${ID}`,
      payload: { position: 12345 },
    });
    expect(res.statusCode).toBe(204);
    const command = calls.find((c) => c.path === '/v2/commands');
    expect(command?.body).toMatchObject({
      name: 'SavePlaybackProgress',
      audiobook_id: ID,
      position: 12345,
    });
  });

  test('POST start answers 204', async () => {
    useFetch(() => json({}));
    login();
    const res = await fastify.inject({ method: 'POST', url: `/api/audioteka/books/${ID}/start` });
    expect(res.statusCode).toBe(204);
  });

  test('an upstream 404 keeps its status', async () => {
    useFetch(() => json({ message: 'nope' }, 404));
    login();
    const res = await fastify.inject({ method: 'GET', url: `/api/audioteka/books/${ID}` });
    expect(res.statusCode).toBe(404);
  });

  test('position without a remote record is null', async () => {
    useFetch(() => json({}, 404));
    login();
    const res = await fastify.inject({ method: 'GET', url: `/api/audioteka/positions/${ID}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('null');
  });

  test('Storytel routes stay 401 when only Audioteka is logged in', async () => {
    useFetch(() => json({}));
    login();
    const res = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });
    expect(res.statusCode).toBe(401);
  });
});
