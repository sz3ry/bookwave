import { encryptPassword } from './passwordCrypt';
import StorytelClient from './storytelApi';

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
  // Rejects with StorytelAuthError when Storytel refuses the credentials; any
  // other failure (network, timeout) rejects with a plain Error. Either way the
  // current session is left as it was.
  login(email: string, password: string): Promise<StoredCredentials>;
  // Starts a session from stored credentials without any network call; the
  // client logs in lazily on its first Storytel request.
  restore(creds: StoredCredentials): void;
  logout(): void;
  getState(): AuthState;
  // Called after Storytel rejected the stored credentials and the session was
  // cleared. Returns an unsubscribe function.
  onCredentialsRejected(listener: () => void): () => void;
}

type ClientFactory = (opts: { onCredentialsRejected: () => void }) => StorytelClient;

// One logged-in account, served by a single shared StorytelClient whose
// Storytel tokens live in memory only. Network errors never end the session;
// only Storytel rejecting the credentials does.
export function createSession(
  createClient: ClientFactory = (opts) => new StorytelClient(opts),
): AuthApi & { getClient(): StorytelClient | null } {
  let client: StorytelClient | null = null;
  let email: string | null = null;
  const listeners = new Set<() => void>();

  const logout = () => {
    client = null;
    email = null;
  };

  // Builds a client whose rejection only ends the session while it is still
  // the current one; a replaced client may still finish an old request.
  const newClient = (): StorytelClient => {
    const created: StorytelClient = createClient({
      onCredentialsRejected: () => {
        if (client !== created) return;
        logout();
        for (const listener of [...listeners]) listener();
      },
    });
    return created;
  };

  return {
    async login(loginEmail, password) {
      const candidate = newClient();
      // On success the client holds the fresh Storytel JWT and the credentials.
      await candidate.login(loginEmail, password);
      client = candidate;
      email = loginEmail.trim();
      return { email, encryptedPassword: encryptPassword(password.trim()) };
    },

    restore(creds) {
      const restored = newClient();
      restored.setCredentials(creds.email, creds.encryptedPassword);
      client = restored;
      email = creds.email.trim();
    },

    logout,

    getState() {
      return { loggedIn: client !== null, email };
    },

    onCredentialsRejected(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getClient() {
      return client;
    },
  };
}
