// No runtime electron import: this module is unit-tested under Bun without Electron.
import type { AudiotekaAuthApi, AudiotekaCredentials, AudiotekaLoginCapture } from '../types';
import {
  type AuthManager,
  type AuthStateView,
  canPersistSecrets,
  type KeyValueStore,
  readSecret,
  type SafeStorageLike,
  type SecretStorage,
  writeSecret,
} from './auth';

// electron-store key holding base64(safeStorage.encryptString(JSON(AudiotekaCredentials))).
// Under `auth.`, so the renderer store IPC cannot reach it (isProtectedStoreKey).
export const AUDIOTEKA_CREDENTIALS_KEY = 'auth.audioteka';

// The only Audioteka auth state the renderer ever sees.
export interface AudiotekaStateView {
  loggedIn: boolean;
  // False when there is no OS keyring: the session then lasts for this run only.
  canPersist: boolean;
}

export type AudiotekaLoginResult =
  | { ok: true; state: AudiotekaStateView }
  | { ok: false; error: 'cancelled' | 'failed' };

export interface ProvidersState {
  storytel: AuthStateView;
  audioteka: AudiotekaStateView;
}

function isAudiotekaCredentials(value: unknown): value is AudiotekaCredentials {
  const v = value as Partial<AudiotekaCredentials> | null;
  const nullableString = (x: unknown) => x === null || typeof x === 'string';
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.deviceId === 'string' &&
    typeof v.refreshId === 'string' &&
    nullableString(v.token) &&
    nullableString(v.expiresAt)
  );
}

// Owns the Audioteka credentials in the main process: logs in through the
// audioteka.com login window, keeps the rotating credentials encrypted with
// the OS keyring when one exists, and restores them on the next start.
export class AudiotekaAuthManager {
  private readonly auth: AudiotekaAuthApi;
  private readonly secrets: SecretStorage;
  private readonly openLogin: () => Promise<AudiotekaLoginCapture | null>;
  private readonly notifyExpired: () => void;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: {
    auth: AudiotekaAuthApi;
    store: KeyValueStore;
    safeStorage: SafeStorageLike;
    platform: NodeJS.Platform;
    openLogin: () => Promise<AudiotekaLoginCapture | null>;
    notifyExpired: () => void;
  }) {
    this.auth = deps.auth;
    this.secrets = { store: deps.store, safeStorage: deps.safeStorage, platform: deps.platform };
    this.openLogin = deps.openLogin;
    this.notifyExpired = deps.notifyExpired;
  }

  // Restores a stored session (no network) and starts listening for rotations
  // and rejections.
  initialize(): void {
    if (!this.unsubscribe) {
      // The refresh id rotates and the previous one stops working: persist
      // synchronously, before the session uses the new token for any request.
      const offChanged = this.auth.onCredentialsChanged((credentials) => {
        writeSecret(this.secrets, AUDIOTEKA_CREDENTIALS_KEY, credentials);
      });
      const offRejected = this.auth.onCredentialsRejected(() => {
        this.secrets.store.remove(AUDIOTEKA_CREDENTIALS_KEY);
        this.notifyExpired();
      });
      this.unsubscribe = () => {
        offChanged();
        offRejected();
      };
    }

    const creds = readSecret(this.secrets, AUDIOTEKA_CREDENTIALS_KEY, isAudiotekaCredentials);
    if (creds) this.auth.restore(creds);
  }

  async login(): Promise<AudiotekaLoginResult> {
    let capture: AudiotekaLoginCapture | null;
    try {
      capture = await this.openLogin();
    } catch (error) {
      console.error('Audioteka login window failed:', error);
      return { ok: false, error: 'failed' };
    }
    if (!capture) return { ok: false, error: 'cancelled' };

    let creds: AudiotekaCredentials;
    try {
      creds = await this.auth.loginWithCapture(capture);
    } catch (error) {
      console.error('Audioteka login failed:', error);
      return { ok: false, error: 'failed' };
    }
    // The rotation listener already stored these; writing again also covers
    // the case where no rotation was reported.
    writeSecret(this.secrets, AUDIOTEKA_CREDENTIALS_KEY, creds);
    return { ok: true, state: this.getState() };
  }

  logout(): void {
    this.auth.logout();
    this.secrets.store.remove(AUDIOTEKA_CREDENTIALS_KEY);
  }

  getState(): AudiotekaStateView {
    return {
      loggedIn: this.auth.getState().loggedIn,
      canPersist: canPersistSecrets(this.secrets.safeStorage, this.secrets.platform),
    };
  }
}

// The provider-aware auth:* IPC handlers. Like createAuthIpcHandlers, each
// waits for the managers to be ready.
export function createAudiotekaIpcHandlers(
  storytelReady: Promise<AuthManager>,
  audiotekaReady: Promise<AudiotekaAuthManager>,
) {
  return {
    async providers(): Promise<ProvidersState> {
      const [storytel, audioteka] = await Promise.all([storytelReady, audiotekaReady]);
      return { storytel: storytel.getState(), audioteka: audioteka.getState() };
    },
    async login(): Promise<AudiotekaLoginResult> {
      return (await audiotekaReady).login();
    },
    async logout(): Promise<void> {
      (await audiotekaReady).logout();
    },
  };
}
