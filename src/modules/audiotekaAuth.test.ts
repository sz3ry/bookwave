import { describe, expect, test } from 'bun:test';
import type { AudiotekaAuthApi, AudiotekaCredentials, AudiotekaLoginCapture } from '../types';
import type { AuthManager } from './auth';
import {
  AUDIOTEKA_CREDENTIALS_KEY,
  AudiotekaAuthManager,
  createAudiotekaIpcHandlers,
} from './audiotekaAuth';
import type { SafeStorageLike } from './auth';

// Redacted placeholders; no real ids or tokens.
const CAPTURE: AudiotekaLoginCapture = { deviceId: 'device-1', refreshId: 'refresh-web' };
const CREDS: AudiotekaCredentials = {
  deviceId: 'device-1',
  refreshId: 'refresh-1',
  token: 'token-1',
  expiresAt: '2026-11-22T00:00:00+00:00',
};
const ROTATED: AudiotekaCredentials = { ...CREDS, refreshId: 'refresh-2', token: 'token-2' };

// Reversible stand-in for the OS keyring (same as auth.test.ts).
function fakeSafeStorage(opts: { available?: boolean; backend?: string } = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => opts.available ?? true,
    getSelectedStorageBackend: () => opts.backend ?? 'gnome_libsecret',
    encryptString: (s) => Buffer.from(`enc:${s}`).reverse(),
    decryptString: (b) => {
      const text = Buffer.from(b).reverse().toString();
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext');
      return text.slice(4);
    },
  };
}

function fakeStore(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  const calls = { set: 0, remove: 0 };
  return {
    data,
    calls,
    get: (key: string) => data.get(key),
    set: (key: string, value: unknown) => {
      calls.set++;
      data.set(key, value);
    },
    remove: (key: string) => {
      calls.remove++;
      data.delete(key);
    },
  };
}

// Mirrors server/audioteka/session.ts: the login refresh rotates the web ids
// and reports the new credentials synchronously before resolving.
function fakeAuth(loginImpl?: (capture: AudiotekaLoginCapture) => Promise<AudiotekaCredentials>) {
  let loggedIn = false;
  const changed = new Set<(c: AudiotekaCredentials) => void>();
  const rejected = new Set<() => void>();
  const captures: AudiotekaLoginCapture[] = [];
  const restored: AudiotekaCredentials[] = [];
  const auth: AudiotekaAuthApi = {
    async loginWithCapture(capture) {
      captures.push(capture);
      const creds = loginImpl ? await loginImpl(capture) : CREDS;
      for (const listener of changed) listener(creds);
      loggedIn = true;
      return creds;
    },
    restore(creds) {
      restored.push(creds);
      loggedIn = true;
    },
    logout() {
      loggedIn = false;
    },
    getState: () => ({ loggedIn }),
    onCredentialsChanged(listener) {
      changed.add(listener);
      return () => changed.delete(listener);
    },
    onCredentialsRejected(listener) {
      rejected.add(listener);
      return () => rejected.delete(listener);
    },
  };
  return {
    auth,
    captures,
    restored,
    rotate(creds: AudiotekaCredentials) {
      for (const listener of changed) listener(creds);
    },
    reject() {
      loggedIn = false;
      for (const listener of rejected) listener();
    },
  };
}

function setup(
  opts: {
    backend?: string;
    available?: boolean;
    stored?: Record<string, unknown>;
    openLogin?: () => Promise<AudiotekaLoginCapture | null>;
    loginImpl?: (capture: AudiotekaLoginCapture) => Promise<AudiotekaCredentials>;
  } = {},
) {
  const fake = fakeAuth(opts.loginImpl);
  const store = fakeStore(opts.stored);
  const safeStorage = fakeSafeStorage(opts);
  let expired = 0;
  const manager = new AudiotekaAuthManager({
    auth: fake.auth,
    store,
    safeStorage,
    platform: 'linux',
    openLogin: opts.openLogin ?? (() => Promise.resolve(CAPTURE)),
    notifyExpired: () => {
      expired++;
    },
  });
  return { manager, store, safeStorage, fake, expiredCount: () => expired };
}

const blobFor = (creds: unknown) =>
  fakeSafeStorage().encryptString(JSON.stringify(creds)).toString('base64');

function storedCreds(store: ReturnType<typeof fakeStore>): unknown {
  const blob = store.data.get(AUDIOTEKA_CREDENTIALS_KEY);
  if (typeof blob !== 'string') return undefined;
  return JSON.parse(fakeSafeStorage().decryptString(Buffer.from(blob, 'base64')));
}

describe('AudiotekaAuthManager.login', () => {
  test('stores encrypted credentials after the captured login', async () => {
    const { manager, store, fake } = setup();
    manager.initialize();
    const result = await manager.login();

    expect(result).toEqual({ ok: true, state: { loggedIn: true, canPersist: true } });
    expect(fake.captures).toEqual([CAPTURE]);
    expect(storedCreds(store)).toEqual(CREDS);
    const blob = store.data.get(AUDIOTEKA_CREDENTIALS_KEY) as string;
    expect(Buffer.from(blob, 'base64').toString()).not.toContain('token-1');
  });

  test('a rotation rewrites the stored blob', async () => {
    const { manager, store, fake } = setup();
    manager.initialize();
    await manager.login();
    fake.rotate(ROTATED);

    expect(storedCreds(store)).toEqual(ROTATED);
  });

  test('a cancelled login window stores nothing', async () => {
    const { manager, store, fake } = setup({ openLogin: () => Promise.resolve(null) });
    manager.initialize();
    const result = await manager.login();

    expect(result).toEqual({ ok: false, error: 'cancelled' });
    expect(fake.captures).toEqual([]);
    expect(store.calls.set).toBe(0);
    expect(manager.getState().loggedIn).toBe(false);
  });

  test('a failing login window or session login maps to failed', async () => {
    const window = setup({ openLogin: () => Promise.reject(new Error('no cookie')) });
    window.manager.initialize();
    expect(await window.manager.login()).toEqual({ ok: false, error: 'failed' });

    const session = setup({ loginImpl: () => Promise.reject(new Error('Login superseded')) });
    session.manager.initialize();
    expect(await session.manager.login()).toEqual({ ok: false, error: 'failed' });
    expect(session.store.calls.set).toBe(0);
  });

  test('without a usable keyring nothing is written but the session works', async () => {
    const { manager, store, fake } = setup({
      backend: 'basic_text',
      stored: { [AUDIOTEKA_CREDENTIALS_KEY]: blobFor(CREDS) },
    });
    manager.initialize();
    const result = await manager.login();
    fake.rotate(ROTATED);

    expect(result).toEqual({ ok: true, state: { loggedIn: true, canPersist: false } });
    expect(store.calls.set).toBe(0);
    // An older account's blob is never left behind to be restored later.
    expect(store.data.has(AUDIOTEKA_CREDENTIALS_KEY)).toBe(false);
  });
});

describe('AudiotekaAuthManager.initialize', () => {
  test('restores from the stored blob', () => {
    const { manager, fake } = setup({ stored: { [AUDIOTEKA_CREDENTIALS_KEY]: blobFor(CREDS) } });
    manager.initialize();

    expect(fake.restored).toEqual([CREDS]);
    expect(manager.getState()).toEqual({ loggedIn: true, canPersist: true });
  });

  test('a blob of the wrong shape is removed', () => {
    const { manager, store, fake } = setup({
      stored: { [AUDIOTEKA_CREDENTIALS_KEY]: blobFor({ deviceId: 'device-1' }) },
    });
    manager.initialize();

    expect(store.data.has(AUDIOTEKA_CREDENTIALS_KEY)).toBe(false);
    expect(fake.restored).toEqual([]);
  });

  test('a rejection removes the stored key and notifies', async () => {
    const { manager, store, fake, expiredCount } = setup();
    manager.initialize();
    await manager.login();
    fake.reject();

    expect(store.data.has(AUDIOTEKA_CREDENTIALS_KEY)).toBe(false);
    expect(expiredCount()).toBe(1);
    expect(manager.getState().loggedIn).toBe(false);
  });
});

describe('AudiotekaAuthManager.logout', () => {
  test('ends the session and removes the stored key', async () => {
    const { manager, store } = setup();
    manager.initialize();
    await manager.login();
    manager.logout();

    expect(store.data.has(AUDIOTEKA_CREDENTIALS_KEY)).toBe(false);
    expect(manager.getState().loggedIn).toBe(false);
  });
});

describe('createAudiotekaIpcHandlers', () => {
  test('providers combines both accounts once they are ready', async () => {
    const { manager } = setup({ stored: { [AUDIOTEKA_CREDENTIALS_KEY]: blobFor(CREDS) } });
    const storytel = {
      getState: () => ({ loggedIn: false, email: null, canPersist: true }),
    } as unknown as AuthManager;
    let markReady!: (m: AudiotekaAuthManager) => void;
    const handlers = createAudiotekaIpcHandlers(
      Promise.resolve(storytel),
      new Promise((resolve) => (markReady = resolve)),
    );

    const pending = handlers.providers();
    manager.initialize();
    markReady(manager);

    expect(await pending).toEqual({
      storytel: { loggedIn: false, email: null, canPersist: true },
      audioteka: { loggedIn: true, canPersist: true },
    });
  });

  test('login and logout go through the manager', async () => {
    const { manager } = setup();
    manager.initialize();
    const handlers = createAudiotekaIpcHandlers(
      Promise.resolve({} as AuthManager),
      Promise.resolve(manager),
    );

    expect(await handlers.login()).toMatchObject({ ok: true });
    await handlers.logout();
    expect(manager.getState().loggedIn).toBe(false);
  });
});
