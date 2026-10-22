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

interface KeyValueStore {
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

    const blob = this.store.get(CREDENTIALS_KEY);
    if (blob === undefined) return;
    // Without a keyring right now the blob cannot be read; keep it for a run
    // where the keyring is back instead of throwing the credentials away.
    if (!this.safeStorage.isEncryptionAvailable()) return;

    let creds: unknown;
    try {
      if (typeof blob !== 'string') throw new Error('Stored credentials are not a string');
      creds = JSON.parse(this.safeStorage.decryptString(Buffer.from(blob, 'base64')));
    } catch {
      creds = undefined;
    }
    if (!isStoredCredentials(creds)) {
      // Unreadable (another keyring, corrupted file): start logged out.
      this.store.remove(CREDENTIALS_KEY);
      return;
    }
    this.auth.restore(creds);
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

    if (this.canPersist()) {
      try {
        const encrypted = this.safeStorage.encryptString(JSON.stringify(creds));
        this.store.set(CREDENTIALS_KEY, encrypted.toString('base64'));
      } catch (error) {
        // The session still works for this run; only the next start needs a login.
        console.error('Failed to persist credentials:', error);
        this.store.remove(CREDENTIALS_KEY);
      }
    } else {
      // Never leave an older account's credentials behind to be restored later.
      this.store.remove(CREDENTIALS_KEY);
    }
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

  // Linux's basic_text backend is a hardcoded key, i.e. effectively plaintext.
  canPersist(): boolean {
    if (!this.safeStorage.isEncryptionAvailable()) return false;
    if (this.platform !== 'linux') return true;
    return this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  }
}
