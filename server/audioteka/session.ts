import { AudiotekaClient, type AudiotekaClientOptions, type AudiotekaCredentials } from './client';

// What the web login hands over: the ids the Audioteka site issued for this device.
export interface AudiotekaLoginCapture {
  deviceId: string;
  refreshId: string;
}

export interface AudiotekaAuthApi {
  // Builds a client from the captured ids and refreshes at once, which turns the
  // short-lived web token into the long-lived one. Resolves with the post-refresh
  // credentials. Rejects ('Login superseded') when logout/restore/another login
  // ran before it finished; the session is then left as it was.
  loginWithCapture(capture: AudiotekaLoginCapture): Promise<AudiotekaCredentials>;
  // Starts a session from stored credentials without any network call.
  restore(creds: AudiotekaCredentials): void;
  logout(): void;
  getState(): { loggedIn: boolean };
  // Called synchronously whenever the client rotates its credentials.
  onCredentialsChanged(listener: (credentials: AudiotekaCredentials) => void): () => void;
  // Called after Audioteka rejected the refresh id and the session was cleared.
  onCredentialsRejected(listener: () => void): () => void;
}

type ClientFactory = (opts: AudiotekaClientOptions) => AudiotekaClient;

// One logged-in Audioteka account, served by a single shared client. Mirrors
// server/session.ts: a generation counter drops logins that were overtaken, and
// only the current client can end the session.
export function createAudiotekaSession(
  createClient: ClientFactory = (opts) => new AudiotekaClient(opts),
): AudiotekaAuthApi & { getClient(): AudiotekaClient | null } {
  let client: AudiotekaClient | null = null;
  let generation = 0;
  const changedListeners = new Set<(credentials: AudiotekaCredentials) => void>();
  const rejectedListeners = new Set<() => void>();

  const logout = () => {
    generation++;
    client = null;
  };

  const newClient = (credentials: AudiotekaCredentials): AudiotekaClient => {
    const created: AudiotekaClient = createClient({
      credentials,
      // Forwarded synchronously: the main process persists inside the listener
      // before any request can use the rotated credentials.
      onCredentialsChanged: (changed) => {
        if (client !== created) return;
        for (const listener of [...changedListeners]) listener(changed);
      },
      onCredentialsRejected: () => {
        if (client !== created) return;
        logout();
        for (const listener of [...rejectedListeners]) listener();
      },
    });
    return created;
  };

  return {
    async loginWithCapture(capture) {
      const started = ++generation;
      let latest: AudiotekaCredentials = {
        deviceId: capture.deviceId,
        refreshId: capture.refreshId,
        token: null,
        expiresAt: null,
      };
      const candidate = createClient({
        credentials: latest,
        onCredentialsChanged: (changed) => {
          latest = changed;
          // Forward while this login is current, or once it became the current
          // client (a later login in flight must not drop its rotations). A
          // superseded, never-adopted login must not leak credentials.
          if (client !== candidate && generation !== started) return;
          for (const listener of [...changedListeners]) listener(changed);
        },
        onCredentialsRejected: () => {
          if (client !== candidate) return;
          logout();
          for (const listener of [...rejectedListeners]) listener();
        },
      });
      await candidate.refresh();
      if (generation !== started) throw new Error('Login superseded');
      client = candidate;
      return latest;
    },

    restore(creds) {
      generation++;
      client = newClient(creds);
    },

    logout,

    getState() {
      return { loggedIn: client !== null };
    },

    onCredentialsChanged(listener) {
      changedListeners.add(listener);
      return () => {
        changedListeners.delete(listener);
      };
    },

    onCredentialsRejected(listener) {
      rejectedListeners.add(listener);
      return () => {
        rejectedListeners.delete(listener);
      };
    },

    getClient() {
      return client;
    },
  };
}
