import { describe, expect, spyOn, test } from 'bun:test';
import type { AuthApi, StoredCredentials } from '../types';
import { AuthManager, CREDENTIALS_KEY, isProtectedStoreKey, type SafeStorageLike } from './auth';

const CREDS: StoredCredentials = { email: 'reader@example.com', encryptedPassword: 'ENC(secret)' };
const PASSWORD = 'plain-secret-password';

// Reversible stand-in for the OS keyring: prefixes and byte-reverses the text.
function fakeSafeStorage(opts: { available?: boolean; backend?: string } = {}) {
  const storage: SafeStorageLike & { failDecrypt: boolean; failEncrypt: boolean } = {
    failDecrypt: false,
    failEncrypt: false,
    isEncryptionAvailable: () => opts.available ?? true,
    getSelectedStorageBackend: () => opts.backend ?? 'gnome_libsecret',
    encryptString: (s) => {
      if (storage.failEncrypt) throw new Error('Error while encrypting the text provided');
      return Buffer.from(`enc:${s}`).reverse();
    },
    decryptString: (b) => {
      if (storage.failDecrypt) throw new Error('Error while decrypting the ciphertext');
      const text = Buffer.from(b).reverse().toString();
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext');
      return text.slice(4);
    },
  };
  return storage;
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

function fakeAuth(loginImpl?: (email: string, password: string) => Promise<StoredCredentials>) {
  let email: string | null = null;
  const listeners = new Set<() => void>();
  const restored: StoredCredentials[] = [];
  const auth: AuthApi = {
    async login(loginEmail, password) {
      const creds = loginImpl ? await loginImpl(loginEmail, password) : CREDS;
      email = creds.email;
      return creds;
    },
    restore(creds) {
      restored.push(creds);
      email = creds.email;
    },
    logout() {
      email = null;
    },
    getState: () => ({ loggedIn: email !== null, email }),
    onCredentialsRejected(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    auth,
    restored,
    // Mirrors the session: it logs out before telling its listeners.
    reject() {
      email = null;
      for (const listener of listeners) listener();
    },
  };
}

function setup(
  opts: {
    platform?: NodeJS.Platform;
    backend?: string;
    available?: boolean;
    stored?: Record<string, unknown>;
    loginImpl?: (email: string, password: string) => Promise<StoredCredentials>;
  } = {},
) {
  const fake = fakeAuth(opts.loginImpl);
  const store = fakeStore(opts.stored);
  const safeStorage = fakeSafeStorage(opts);
  let expired = 0;
  const manager = new AuthManager({
    auth: fake.auth,
    store,
    safeStorage,
    platform: opts.platform ?? 'linux',
    notifyExpired: () => {
      expired++;
    },
  });
  return { manager, store, safeStorage, fake, expiredCount: () => expired };
}

const blobFor = (creds: StoredCredentials) =>
  fakeSafeStorage().encryptString(JSON.stringify(creds)).toString('base64');

describe('AuthManager.canPersist', () => {
  test('canPersist is false for basic_text', () => {
    expect(setup({ platform: 'linux', backend: 'basic_text' }).manager.canPersist()).toBe(false);
  });

  test('canPersist is true for gnome_libsecret and on win32', () => {
    expect(setup({ platform: 'linux', backend: 'gnome_libsecret' }).manager.canPersist()).toBe(
      true,
    );
    expect(setup({ platform: 'win32', backend: 'unknown' }).manager.canPersist()).toBe(true);
  });

  test('canPersist is false when encryption is unavailable', () => {
    expect(setup({ platform: 'win32', available: false }).manager.canPersist()).toBe(false);
  });
});

describe('AuthManager.login', () => {
  test('login persists encrypted credentials', async () => {
    const { manager, store, safeStorage } = setup();
    const result = await manager.login(CREDS.email, PASSWORD);

    expect(result).toEqual({
      ok: true,
      state: { loggedIn: true, email: CREDS.email, canPersist: true },
    });
    const blob = store.data.get(CREDENTIALS_KEY);
    expect(typeof blob).toBe('string');
    expect(blob as string).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(blob as string).not.toContain(PASSWORD);
    expect(Buffer.from(blob as string, 'base64').toString()).not.toContain(PASSWORD);
    const decrypted = safeStorage.decryptString(Buffer.from(blob as string, 'base64'));
    expect(JSON.parse(decrypted)).toEqual(CREDS);
  });

  test('login without persistence stores nothing', async () => {
    const { manager, store } = setup({ backend: 'basic_text' });
    const result = await manager.login(CREDS.email, PASSWORD);

    expect(store.calls.set).toBe(0);
    expect(store.data.has(CREDENTIALS_KEY)).toBe(false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.canPersist).toBe(false);
  });

  test('invalid credentials map to invalid_credentials', async () => {
    const { manager, store } = setup({
      loginImpl: () =>
        Promise.reject(Object.assign(new Error('nope'), { isStorytelUnauthorized: true })),
    });
    const result = await manager.login(CREDS.email, 'wrong');

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(store.calls.set).toBe(0);
    expect(manager.getState().loggedIn).toBe(false);
  });

  test('non-persisting login removes an older blob', async () => {
    const { manager, store } = setup({
      backend: 'basic_text',
      stored: { [CREDENTIALS_KEY]: blobFor(CREDS) },
    });
    const result = await manager.login(CREDS.email, PASSWORD);

    expect(result.ok).toBe(true);
    expect(store.calls.set).toBe(0);
    expect(store.data.has(CREDENTIALS_KEY)).toBe(false);
  });

  test('encryptString failure leaves a logged-in session without a stored key', async () => {
    const { manager, store, safeStorage } = setup({
      stored: { [CREDENTIALS_KEY]: blobFor(CREDS) },
    });
    safeStorage.failEncrypt = true;
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const result = await manager.login(CREDS.email, PASSWORD);
    errorSpy.mockRestore();

    expect(result).toEqual({
      ok: true,
      state: { loggedIn: true, email: CREDS.email, canPersist: true },
    });
    expect(store.data.has(CREDENTIALS_KEY)).toBe(false);
  });

  test('any other failure maps to failed with its message', async () => {
    const { manager, store } = setup({
      loginImpl: () => Promise.reject(new Error('Login failed: fetch failed')),
    });
    const result = await manager.login(CREDS.email, PASSWORD);

    expect(result).toEqual({ ok: false, error: 'failed', message: 'Login failed: fetch failed' });
    expect(store.calls.set).toBe(0);
  });
});

describe('AuthManager.initialize', () => {
  test('initialize restores without network', () => {
    const { manager, fake } = setup({ stored: { [CREDENTIALS_KEY]: blobFor(CREDS) } });
    manager.initialize();

    expect(fake.restored).toEqual([CREDS]);
    expect(manager.getState()).toEqual({ loggedIn: true, email: CREDS.email, canPersist: true });
  });

  test('a blob that fails to decrypt is kept and the app starts logged out', () => {
    const blob = blobFor(CREDS);
    const { manager, store, safeStorage, fake } = setup({
      stored: { [CREDENTIALS_KEY]: blob },
    });
    // A locked keyring or a cancelled unlock prompt makes decryptString throw.
    safeStorage.failDecrypt = true;
    manager.initialize();

    expect(store.calls.remove).toBe(0);
    expect(store.data.get(CREDENTIALS_KEY)).toBe(blob);
    expect(fake.restored).toEqual([]);
    expect(manager.getState().loggedIn).toBe(false);
  });

  test('a blob that decrypts to invalid JSON is removed', () => {
    const blob = fakeSafeStorage().encryptString('not json').toString('base64');
    const { manager, store, fake } = setup({ stored: { [CREDENTIALS_KEY]: blob } });
    manager.initialize();

    expect(store.data.has(CREDENTIALS_KEY)).toBe(false);
    expect(fake.restored).toEqual([]);
    expect(manager.getState().loggedIn).toBe(false);
  });

  test('keeps stored blob when the backend cannot persist', () => {
    const blob = blobFor(CREDS);
    const { manager, store, fake } = setup({
      backend: 'basic_text',
      stored: { [CREDENTIALS_KEY]: blob },
    });
    manager.initialize();

    expect(store.calls.remove).toBe(0);
    expect(store.data.get(CREDENTIALS_KEY)).toBe(blob);
    expect(fake.restored).toEqual([]);
    expect(manager.getState().loggedIn).toBe(false);
  });

  test('a blob that decrypts to the wrong shape is removed', () => {
    const blob = fakeSafeStorage().encryptString('{"email":42}').toString('base64');
    const { manager, store, fake } = setup({ stored: { [CREDENTIALS_KEY]: blob } });
    manager.initialize();

    expect(store.data.has(CREDENTIALS_KEY)).toBe(false);
    expect(fake.restored).toEqual([]);
  });

  test('onCredentialsRejected wipes stored credentials', async () => {
    const { manager, store, fake, expiredCount } = setup();
    manager.initialize();
    await manager.login(CREDS.email, PASSWORD);
    expect(store.data.has(CREDENTIALS_KEY)).toBe(true);

    fake.reject();

    expect(store.data.has(CREDENTIALS_KEY)).toBe(false);
    expect(expiredCount()).toBe(1);
    expect(manager.getState().loggedIn).toBe(false);
  });
});

describe('AuthManager.logout', () => {
  test('logout ends the session and removes stored credentials', async () => {
    const { manager, store } = setup();
    await manager.login(CREDS.email, PASSWORD);
    manager.logout();

    expect(store.data.has(CREDENTIALS_KEY)).toBe(false);
    expect(manager.getState().loggedIn).toBe(false);
  });
});

describe('isProtectedStoreKey', () => {
  test('protects the auth namespace only', () => {
    expect(isProtectedStoreKey('auth.credentials')).toBe(true);
    expect(isProtectedStoreKey('auth')).toBe(true);
    expect(isProtectedStoreKey('authorName')).toBe(false);
    expect(isProtectedStoreKey('settings.alwaysOnTop')).toBe(false);
    expect(isProtectedStoreKey('hasSeenWelcome')).toBe(false);
  });
});
