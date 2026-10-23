import type { BrowserWindow } from 'electron';

export interface PlayingState {
  isPlaying: boolean;
  bookTitle: string | null;
  isAuthenticated?: boolean;
}

export interface ApiConfig {
  headers?: Record<string, string>;
}

export interface ApiResponse {
  data: any;
}

export interface WindowConfig {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  x?: number;
  y?: number;
  resizable: boolean;
  maximizable: boolean;
  alwaysOnTop: boolean;
}

export interface AppContext {
  mainWindow: BrowserWindow | null;
  isDev: boolean;
  isDebug: boolean;
}

// Copies of the server's session types (server/storytel/session.ts): the main
// process is compiled separately and cannot import the server's TS sources.

// What the main process persists to restore a session on the next start: the
// encrypted password is the form Storytel's login.action expects.
export interface StoredCredentials {
  email: string;
  encryptedPassword: string;
}

export interface AuthState {
  loggedIn: boolean;
  email: string | null;
}

export interface AuthApi {
  // Rejects with an error carrying `isStorytelUnauthorized` when Storytel
  // refuses the credentials; any other failure (network, timeout, a login
  // superseded by logout/restore/another login) rejects with a plain Error.
  login(email: string, password: string): Promise<StoredCredentials>;
  // Starts a session from stored credentials without any network call.
  restore(creds: StoredCredentials): void;
  logout(): void;
  getState(): AuthState;
  // Called after Storytel rejected the stored credentials and the session was
  // cleared. Returns an unsubscribe function.
  onCredentialsRejected(listener: () => void): () => void;
}

// Copies of the Audioteka session types (server/audioteka/session.ts and
// server/audioteka/client.ts), for the same reason.

// What the main process persists to restore an Audioteka session; refreshId
// rotates on every refresh and deviceId must stay the one the login used.
export interface AudiotekaCredentials {
  deviceId: string;
  refreshId: string;
  token: string | null;
  expiresAt: string | null;
}

// What the web login hands over: the ids the Audioteka site issued for this device.
export interface AudiotekaLoginCapture {
  deviceId: string;
  refreshId: string;
}

export interface AudiotekaAuthApi {
  // Refreshes at once with the captured ids; rejects when the refresh fails or
  // the login was superseded by logout/restore/another login.
  loginWithCapture(capture: AudiotekaLoginCapture): Promise<AudiotekaCredentials>;
  // Starts a session from stored credentials without any network call.
  restore(creds: AudiotekaCredentials): void;
  logout(): void;
  getState(): { loggedIn: boolean };
  // Called synchronously whenever the client rotates its credentials; the
  // listener must persist before returning.
  onCredentialsChanged(listener: (credentials: AudiotekaCredentials) => void): () => void;
  // Called after Audioteka rejected the refresh id and the session was cleared.
  onCredentialsRejected(listener: () => void): () => void;
}
