import { describe, expect, test } from 'bun:test';
import type { FetchLike } from './fetch';
import { encryptPassword } from './passwordCrypt';
import { createSession } from './session';
import StorytelClient from './client';

const LOGIN_PATH = '/api/login.action';
const BOOKSHELF_PATH = '/libraries/bookshelf';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function makeJwt(expInSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none' })}.${b64url({ iat: now, exp: now + expInSeconds })}.sig`;
}

// Records every request path and answers from a per-path handler.
function stubFetch(routes: Record<string, () => Response>) {
  const paths: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const { pathname } = new URL(String(input));
    paths.push(pathname);
    const route = routes[pathname];
    if (!route) throw new Error(`unexpected request to ${pathname}`);
    return route();
  };
  return { fetchImpl, paths };
}

function sessionWith(fetchImpl: FetchLike) {
  return createSession((opts) => new StorytelClient({ ...opts, fetch: fetchImpl }));
}

// Lets pending fetch calls start before the test resolves them.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const creds = { email: 'reader@example.com', encryptedPassword: encryptPassword('secret') };

describe('session', () => {
  test('login stores credentials and returns encrypted password', async () => {
    const jwt = makeJwt(3600);
    const { fetchImpl, paths } = stubFetch({
      [LOGIN_PATH]: () => json({ accountInfo: { jwt, singleSignToken: 'sst' } }),
      [BOOKSHELF_PATH]: () => json({ items: {} }),
    });
    const session = sessionWith(fetchImpl);

    const result = await session.login('reader@example.com', 'secret');

    expect(result).toEqual({
      email: 'reader@example.com',
      encryptedPassword: encryptPassword('secret'),
    });
    expect(session.getState()).toEqual({ loggedIn: true, email: 'reader@example.com' });

    // The shared client already holds the fresh JWT: no second login.
    await session.getClient()?.getBookshelf();
    expect(paths).toEqual([LOGIN_PATH, BOOKSHELF_PATH]);
  });

  test('login with rejected credentials throws and leaves state unchanged', async () => {
    const { fetchImpl } = stubFetch({
      [LOGIN_PATH]: () => json({ error: 'bad credentials' }, 401),
    });
    const session = sessionWith(fetchImpl);

    const error = await session
      .login('reader@example.com', 'wrong')
      .catch((e: unknown) => e as { isStorytelUnauthorized?: boolean });

    expect(error.isStorytelUnauthorized).toBe(true);
    expect(session.getState()).toEqual({ loggedIn: false, email: null });
    expect(session.getClient()).toBeNull();
  });

  test('login network error is not an auth error and leaves state unchanged', async () => {
    const { fetchImpl } = stubFetch({
      [LOGIN_PATH]: () => {
        throw new TypeError('fetch failed');
      },
    });
    const session = sessionWith(fetchImpl);
    session.restore(creds);
    const client = session.getClient();

    const error = await session
      .login('other@example.com', 'secret')
      .catch((e: unknown) => e as { isStorytelUnauthorized?: boolean });

    expect(error).toBeInstanceOf(Error);
    expect(error.isStorytelUnauthorized).toBeUndefined();
    expect(session.getState()).toEqual({ loggedIn: true, email: creds.email });
    expect(session.getClient()).toBe(client);
  });

  test('login reply without a token fails without an auth error or a session', async () => {
    const { fetchImpl } = stubFetch({
      [LOGIN_PATH]: () => json({ accountInfo: { singleSignToken: 'sst' } }),
    });
    const session = sessionWith(fetchImpl);

    const error = await session
      .login('reader@example.com', 'secret')
      .catch((e: unknown) => e as Error & { isStorytelUnauthorized?: boolean });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Storytel login returned no token');
    expect(error.isStorytelUnauthorized).toBeUndefined();
    expect(session.getState()).toEqual({ loggedIn: false, email: null });
    expect(session.getClient()).toBeNull();
  });

  test('restore() makes no network call', () => {
    const { fetchImpl, paths } = stubFetch({});
    const session = sessionWith(fetchImpl);

    session.restore(creds);

    expect(paths).toHaveLength(0);
    expect(session.getState()).toEqual({ loggedIn: true, email: creds.email });
    expect(session.getClient()).not.toBeNull();
  });

  test('rejected login clears session and notifies', () => {
    const rejectors: Array<() => void> = [];
    const session = createSession((opts) => {
      rejectors.push(opts.onCredentialsRejected);
      return new StorytelClient(opts);
    });
    let notified = 0;
    session.onCredentialsRejected(() => notified++);
    session.restore(creds);

    rejectors[0]();

    expect(notified).toBe(1);
    expect(session.getState()).toEqual({ loggedIn: false, email: null });
    expect(session.getClient()).toBeNull();
  });

  test('a replaced client reporting rejection does not end the new session', () => {
    const rejectors: Array<() => void> = [];
    const session = createSession((opts) => {
      rejectors.push(opts.onCredentialsRejected);
      return new StorytelClient(opts);
    });
    let notified = 0;
    session.onCredentialsRejected(() => notified++);
    session.restore(creds);
    session.restore({ ...creds, email: 'second@example.com' });

    rejectors[0]();

    expect(notified).toBe(0);
    expect(session.getState()).toEqual({ loggedIn: true, email: 'second@example.com' });
  });

  test('unsubscribed listeners are not notified', () => {
    const rejectors: Array<() => void> = [];
    const session = createSession((opts) => {
      rejectors.push(opts.onCredentialsRejected);
      return new StorytelClient(opts);
    });
    let notified = 0;
    const unsubscribe = session.onCredentialsRejected(() => notified++);
    unsubscribe();
    session.restore(creds);

    rejectors[0]();

    expect(notified).toBe(0);
    expect(session.getState().loggedIn).toBe(false);
  });

  test('logout during in-flight login keeps the user logged out', async () => {
    let resolveLogin: (response: Response) => void = () => {};
    const fetchImpl: FetchLike = () =>
      new Promise<Response>((resolve) => {
        resolveLogin = resolve;
      });
    const session = sessionWith(fetchImpl);

    const pending = session.login('reader@example.com', 'secret').catch((e: unknown) => e);
    await flush();
    session.logout();
    resolveLogin(json({ accountInfo: { jwt: makeJwt(3600), singleSignToken: 'sst' } }));
    const result = await pending;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('Login superseded');
    expect(session.getState()).toEqual({ loggedIn: false, email: null });
    expect(session.getClient()).toBeNull();
  });

  test('newer login wins over an older in-flight login', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetchImpl: FetchLike = () =>
      new Promise<Response>((resolve) => {
        resolvers.push(resolve);
      });
    const session = sessionWith(fetchImpl);
    const ok = () => json({ accountInfo: { jwt: makeJwt(3600), singleSignToken: 'sst' } });

    const older = session.login('old@example.com', 'secret').catch((e: unknown) => e);
    const newer = session.login('new@example.com', 'secret');
    await flush();
    resolvers[1](ok());
    await newer;
    resolvers[0](ok());

    expect(await older).toBeInstanceOf(Error);
    expect(session.getState()).toEqual({ loggedIn: true, email: 'new@example.com' });
  });

  test('logout clears state', () => {
    const session = sessionWith(stubFetch({}).fetchImpl);
    session.restore(creds);

    session.logout();

    expect(session.getState()).toEqual({ loggedIn: false, email: null });
    expect(session.getClient()).toBeNull();
  });
});
