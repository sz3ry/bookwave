import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FetchLike } from './http/storytelFetch';
import { encryptPassword } from './passwordCrypt';

// fastify-common creates its downloads directory and the logger reads its log
// file at import time, so point both at a temporary directory first.
// The variables are restored afterwards so other test files do not see them.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookwave-routes-'));
const testEnv = {
  IS_ELECTRON: 'true',
  DOWNLOAD_PATH: tmpDir,
  USER_DATA_PATH: tmpDir,
  NODE_ENV: 'production', // silences the Fastify request logger
};
const savedEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));
Object.assign(process.env, testEnv);

const { default: fastify, auth, configureSession } = await import('./fastify-common');

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const LOGIN_PATH = '/api/login.action';
const BOOKSHELF_PATH = '/libraries/bookshelf';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = `${b64url({ alg: 'none' })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

function useFetch(routes: Record<string, () => Response>) {
  const fetchImpl: FetchLike = async (input) => {
    const { pathname } = new URL(String(input));
    const route = routes[pathname];
    if (!route) throw new Error(`unexpected request to ${pathname}`);
    return route();
  };
  configureSession({ fetch: fetchImpl });
}

const creds = { email: 'reader@example.com', encryptedPassword: encryptPassword('secret') };

afterEach(() => {
  auth.logout();
});

afterAll(async () => {
  await fastify.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('routes', () => {
  test('routes return 401 without session', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Not authenticated' });
  });

  test('routes use the restored session', async () => {
    useFetch({
      [LOGIN_PATH]: () => json({ accountInfo: { jwt, singleSignToken: 'sst' } }),
      [BOOKSHELF_PATH]: () => json({ items: {} }),
    });
    auth.restore(creds);

    const response = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ books: [] });
  });

  test('network error does not reject credentials', async () => {
    useFetch({
      [LOGIN_PATH]: () => {
        throw new TypeError('fetch failed');
      },
      [BOOKSHELF_PATH]: () => {
        throw new TypeError('fetch failed');
      },
    });
    auth.restore(creds);

    const response = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(auth.getState().loggedIn).toBe(true);
  });

  test('rejected credentials end the session and reply 401', async () => {
    useFetch({
      [LOGIN_PATH]: () => json({ error: 'bad credentials' }, 401),
    });
    auth.restore(creds);
    let notified = 0;
    const unsubscribe = auth.onCredentialsRejected(() => notified++);

    const response = await fastify.inject({ method: 'GET', url: '/api/bookshelf' });
    unsubscribe();

    expect(response.statusCode).toBe(401);
    expect(notified).toBe(1);
    expect(auth.getState()).toEqual({ loggedIn: false, email: null });
  });

  test('local download routes need a session but no Storytel call', async () => {
    useFetch({});
    const without = await fastify.inject({ method: 'GET', url: '/api/download-status/123' });
    expect(without.statusCode).toBe(401);

    auth.restore(creds);
    const response = await fastify.inject({ method: 'GET', url: '/api/download-status/123' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ downloaded: false });
  });

  test('translations stay public', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/api/translations?lang=en' });

    expect(response.statusCode).toBe(200);
  });

  test('JWT auth routes are gone', async () => {
    for (const [method, url] of [
      ['POST', '/api/login'],
      ['POST', '/api/logout'],
      ['GET', '/api/auth/status'],
      ['GET', '/api/account'],
    ] as const) {
      const response = await fastify.inject({ method, url });
      expect(response.statusCode).toBe(404);
    }
  });
});
