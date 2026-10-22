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

// Copies of the server's session types (server/session.ts): the main process
// is compiled separately and cannot import the server's TS sources.

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
