// No runtime electron import: this module is unit-tested under Bun without Electron.
import type { AuthApi, StoredCredentials } from '../types';

// The subset of Electron's safeStorage the manager needs.
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  // Linux only in Electron; absent elsewhere.
  getSelectedStorageBackend?(): string;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}

// The only auth state the renderer ever sees.
export interface AuthStateView {
  loggedIn: boolean;
  email: string | null;
  // False when there is no OS keyring: the session then lasts for this run only.
  canPersist: boolean;
}

export type LoginResult =
  | { ok: true; state: AuthStateView }
  | { ok: false; error: 'invalid_credentials' | 'failed'; message?: string };

export interface KeyValueStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

// electron-store key holding base64(safeStorage.encryptString(JSON(StoredCredentials))).
export const CREDENTIALS_KEY = 'auth.credentials';

// Keys under `auth` are owned by the main process; the generic renderer store
// IPC must not read, write or delete them.
export function isProtectedStoreKey(key: string): boolean {
  return key === 'auth' || key.startsWith('auth.');
}

// Linux's basic_text backend is a hardcoded key, i.e. effectively plaintext.
export function canPersistSecrets(
  safeStorage: SafeStorageLike,
  platform: NodeJS.Platform,
): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (platform !== 'linux') return true;
  return safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
}

export interface SecretStorage {
  store: KeyValueStore;
  safeStorage: SafeStorageLike;
  platform: NodeJS.Platform;
}

// Reads a JSON value stored as base64(safeStorage.encryptString(JSON)).
// Returns null when there is nothing usable; removes only a blob that is
// definitely corrupted, never one that merely cannot be read right now.
export function readSecret<T>(
  { store, safeStorage, platform }: SecretStorage,
  key: string,
  isValid: (value: unknown) => value is T,
): T | null {
  const blob = store.get(key);
  if (blob === undefined) return null;
  // Without a usable keyring right now (none, or a basic_text fallback) the
  // blob cannot be read; keep it for a run where the keyring is back instead
  // of throwing the credentials away.
  if (!canPersistSecrets(safeStorage, platform)) return null;

  if (typeof blob !== 'string') {
    // Not something safeStorage ever wrote: the store value is corrupted.
    store.remove(key);
    return null;
  }

  let text: string;
  try {
    text = safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch (error) {
    // A locked keyring or a cancelled unlock prompt: start logged out but
    // keep the blob, a later run with the keyring unlocked can still read it.
    console.error('Failed to decrypt stored credentials:', error);
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (!isValid(value)) {
    // Decrypted but not our credentials (corrupted file): start logged out.
    store.remove(key);
    return null;
  }
  return value;
}

// Stores `value` encrypted when the keyring can hold it; otherwise removes the
// key, so an older account's credentials are never left behind to be restored.
export function writeSecret(
  { store, safeStorage, platform }: SecretStorage,
  key: string,
  value: unknown,
): void {
  if (!canPersistSecrets(safeStorage, platform)) {
    store.remove(key);
    return;
  }
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(value));
    store.set(key, encrypted.toString('base64'));
  } catch (error) {
    // The session still works for this run; only the next start needs a login.
    console.error('Failed to persist credentials:', error);
    store.remove(key);
  }
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
  const v = value as Partial<StoredCredentials> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.email === 'string' &&
    typeof v.encryptedPassword === 'string'
  );
}

// Owns the Storytel credentials in the main process: logs in through the
// server's session, keeps the credentials encrypted with the OS keyring
// (safeStorage) when one exists, and restores them on the next start.
export class AuthManager {
  private readonly auth: AuthApi;
  private readonly store: KeyValueStore;
  private readonly safeStorage: SafeStorageLike;
  private readonly platform: NodeJS.Platform;
  private readonly notifyExpired: () => void;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: {
    auth: AuthApi;
    store: KeyValueStore;
    safeStorage: SafeStorageLike;
    platform: NodeJS.Platform;
    notifyExpired: () => void;
  }) {
    this.auth = deps.auth;
    this.store = deps.store;
    this.safeStorage = deps.safeStorage;
    this.platform = deps.platform;
    this.notifyExpired = deps.notifyExpired;
  }

  // Restores a stored session (no network: the client logs in lazily) and
  // starts listening for Storytel rejecting the credentials.
  initialize(): void {
    if (!this.unsubscribe) {
      this.unsubscribe = this.auth.onCredentialsRejected(() => {
        this.store.remove(CREDENTIALS_KEY);
        this.notifyExpired();
      });
    }

    const creds = readSecret(this.secrets(), CREDENTIALS_KEY, isStoredCredentials);
    if (creds) this.auth.restore(creds);
  }

  async login(email: string, password: string): Promise<LoginResult> {
    let creds: StoredCredentials;
    try {
      creds = await this.auth.login(email, password);
    } catch (error) {
      if ((error as { isStorytelUnauthorized?: boolean } | null)?.isStorytelUnauthorized) {
        return { ok: false, error: 'invalid_credentials' };
      }
      return {
        ok: false,
        error: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    writeSecret(this.secrets(), CREDENTIALS_KEY, creds);
    return { ok: true, state: this.getState() };
  }

  logout(): void {
    this.auth.logout();
    this.store.remove(CREDENTIALS_KEY);
  }

  getState(): AuthStateView {
    const { loggedIn, email } = this.auth.getState();
    return { loggedIn, email, canPersist: this.canPersist() };
  }

  canPersist(): boolean {
    return canPersistSecrets(this.safeStorage, this.platform);
  }

  private secrets(): SecretStorage {
    return { store: this.store, safeStorage: this.safeStorage, platform: this.platform };
  }
}

// The auth:* IPC handlers. They are registered before the window loads and
// each waits for `ready`, so a renderer asking during startup gets the
// restored session instead of "No handler registered" or a logged-out state.
export function createAuthIpcHandlers(ready: Promise<AuthManager>) {
  return {
    async login(email: unknown, password: unknown): Promise<LoginResult> {
      if (typeof email !== 'string' || typeof password !== 'string') {
        return { ok: false, error: 'failed', message: 'Invalid login arguments' };
      }
      return (await ready).login(email, password);
    },
    async logout(): Promise<void> {
      (await ready).logout();
    },
    async state(): Promise<AuthStateView> {
      return (await ready).getState();
    },
  };
}
