import { describe, expect, test } from 'bun:test';
import { appLogger } from '../logger';
import { createStorytelFetch, type FetchLike, StorytelAuthError, StorytelHttpError } from './fetch';

interface Call {
  url: URL;
  init: RequestInit;
}

function stub(respond: () => Response): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return respond();
  };
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('storytelFetch', () => {
  test('adds base headers and version param', async () => {
    const { fetchImpl, calls } = stub(() => json({ ok: true }));
    const res = await createStorytelFetch(fetchImpl)({
      url: 'https://api.storytel.net/x',
      query: { a: 'b' },
    });
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('x-storytel-terminal')).toBe('ios');
    expect(headers.get('user-agent')).toBe('Storytel/25.38.0 (iOS 26.0; iPhone16,2) Release/924.1');
    expect(calls[0].url.searchParams.get('version')).toBe('25.38.0');
    expect(calls[0].url.searchParams.get('a')).toBe('b');
    expect(res.data).toEqual({ ok: true });
  });

  test('uses manual redirects', async () => {
    const { fetchImpl, calls } = stub(
      () => new Response(null, { status: 302, headers: { location: 'https://x.test/next' } }),
    );
    const res = await createStorytelFetch(fetchImpl)({ url: 'https://api.storytel.net/x' });
    expect(calls[0].init.redirect).toBe('manual');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://x.test/next');
  });

  test('form body is sent verbatim', async () => {
    const { fetchImpl, calls } = stub(() => json({}));
    await createStorytelFetch(fetchImpl)({
      method: 'POST',
      url: 'https://api.storytel.net/x',
      body: { form: '' },
    });
    expect(calls[0].init.body).toBe('');
    expect(new Headers(calls[0].init.headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
  });

  test('json body is serialized', async () => {
    const { fetchImpl, calls } = stub(() => json({}));
    await createStorytelFetch(fetchImpl)({
      method: 'POST',
      url: 'https://api.storytel.net/x',
      body: { json: { a: 1 } },
    });
    expect(calls[0].init.body).toBe('{"a":1}');
    expect(new Headers(calls[0].init.headers).get('content-type')).toBe('application/json');
  });

  test('401 throws StorytelAuthError', async () => {
    const { fetchImpl } = stub(() => json({ msg: 'no' }, 401));
    const err = await createStorytelFetch(fetchImpl)({ url: 'https://api.storytel.net/x' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(StorytelAuthError);
    expect(err).toBeInstanceOf(StorytelHttpError);
    expect(err.isStorytelUnauthorized).toBe(true);
    expect(err.storytelStatus).toBe(401);
    expect(err.storytelData).toEqual({ msg: 'no' });
  });

  test('500 throws StorytelHttpError with status and data', async () => {
    const { fetchImpl } = stub(
      () => new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }),
    );
    const err = await createStorytelFetch(fetchImpl)({ url: 'https://api.storytel.net/x' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(StorytelHttpError);
    expect(err).not.toBeInstanceOf(StorytelAuthError);
    expect(err.status).toBe(500);
    expect(err.data).toBe('boom');
  });

  test('timeout aborts', async () => {
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    await expect(
      createStorytelFetch(fetchImpl)({ url: 'https://api.storytel.net/x', timeoutMs: 10 }),
    ).rejects.toBeDefined();
  });

  test('masks password in logs', async () => {
    const { fetchImpl } = stub(() => json({ ok: 1 }));
    await createStorytelFetch(fetchImpl)({
      url: 'https://api.storytel.net/login.action',
      query: { uid: 'u', pwd: 'SECRET' },
    });
    const dump = JSON.stringify(appLogger.getLogs?.() ?? []);
    expect(dump).toContain('pwd=***');
    expect(dump).not.toContain('SECRET');
  });

  test('parses JSON body served as text/html', async () => {
    const { fetchImpl } = stub(
      () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const res = await createStorytelFetch(fetchImpl)({ url: 'https://api.storytel.net/x' });
    expect(res.data).toEqual({ a: 1 });
  });

  test('caller header overrides base header case-insensitively', async () => {
    const { fetchImpl, calls } = stub(() => json({}));
    await createStorytelFetch(fetchImpl)({
      url: 'https://api.storytel.net/x',
      headers: { 'User-Agent': 'custom/1' },
    });
    expect(new Headers(calls[0].init.headers).get('user-agent')).toBe('custom/1');
  });
});
