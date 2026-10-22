import { appLogger } from '../logger';
import type { FetchLike } from '../http/storytelFetch';
import {
  type AudiotekaBook,
  type AudiotekaLibraryEntry,
  type AudiotekaRemotePosition,
  type AudiotekaTrack,
  isListenable,
  mergeLibrary,
  toAudiotekaBook,
  toRemotePosition,
  toTimeline,
} from './mapping';

const API_BASE = 'https://api-audioteka.audioteka.com';
const FALLBACK_APP_VERSION = '3.55.0';
const DEVICE_NAME = 'Bookwave';
const REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;
const LICENSE_CONCURRENCY = 4;
const LIST_QUERY = '?page=1&limit=100';

export interface AudiotekaCredentials {
  deviceId: string;
  refreshId: string;
  token: string | null;
  expiresAt: string | null;
}

// The refresh id was rejected: the session is over and the user must log in again.
export class AudiotekaUnauthorizedError extends Error {
  readonly isAudiotekaUnauthorized = true;

  constructor(message = 'Audioteka session expired') {
    super(message);
    this.name = 'AudiotekaUnauthorizedError';
  }
}

export class AudiotekaHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AudiotekaHttpError';
    this.status = status;
  }
}

export interface AudiotekaClientOptions {
  credentials: AudiotekaCredentials;
  fetch?: FetchLike;
  now?: () => number;
  onCredentialsChanged: (credentials: AudiotekaCredentials) => void;
  onCredentialsRejected: () => void;
}

interface RequestOptions {
  body?: Record<string, unknown>;
  auth?: boolean;
  // Statuses returned to the caller instead of thrown.
  allowStatus?: number[];
}

interface ApiResponse {
  status: number;
  data: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class AudiotekaClient {
  private credentials: AudiotekaCredentials;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly onCredentialsChanged: (credentials: AudiotekaCredentials) => void;
  private readonly onCredentialsRejected: () => void;
  private refreshing: Promise<void> | null = null;
  private userAgent: Promise<string> | null = null;

  constructor(opts: AudiotekaClientOptions) {
    this.credentials = { ...opts.credentials };
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.onCredentialsChanged = opts.onCredentialsChanged;
    this.onCredentialsRejected = opts.onCredentialsRejected;
  }

  // Concurrent callers share one in-flight refresh.
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async getLibrary(): Promise<AudiotekaLibraryEntry[]> {
    const [recent, favourites, shelf, positions] = await Promise.all([
      this.get(`/v2/me/recently-played${LIST_QUERY}`),
      this.get(`/v2/me/favourites${LIST_QUERY}`),
      this.get(`/v2/me/shelf${LIST_QUERY}`),
      this.get(`/v2/me/playback-progress${LIST_QUERY}`),
    ]);
    const entries = mergeLibrary({ recent, favourites, shelf }, positions);

    let next = 0;
    const worker = async () => {
      while (next < entries.length) {
        const entry = entries[next++];
        try {
          const channels = await this.get(
            `/v2/me/audiobook-license-channels/${encodeURIComponent(entry.id)}`,
          );
          entry.available = isListenable(channels);
        } catch {
          // Fail open: an unknown license state must not hide the book.
          entry.available = true;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(LICENSE_CONCURRENCY, entries.length) }, worker),
    );
    return entries;
  }

  async getBook(id: string): Promise<AudiotekaBook> {
    const book = toAudiotekaBook(await this.get(`/v2/audiobooks/${encodeURIComponent(id)}`));
    if (!book) throw new Error(`Audioteka returned an unreadable audiobook ${id}`);
    return book;
  }

  async getTimeline(id: string): Promise<AudiotekaTrack[]> {
    return toTimeline(await this.get(`/v2/audiobooks/${encodeURIComponent(id)}/tracks`));
  }

  async getTrackUrl(trackId: string): Promise<{ url: string; expiresAt: number }> {
    const data = await this.get(`/v2/tracks/${encodeURIComponent(trackId)}/stream`);
    if (!isRecord(data) || typeof data.url !== 'string' || !data.url) {
      throw new Error(`Audioteka returned no stream URL for track ${trackId}`);
    }
    const lifetime =
      typeof data.lifetime_in_seconds === 'number' && Number.isFinite(data.lifetime_in_seconds)
        ? data.lifetime_in_seconds
        : 0;
    return { url: data.url, expiresAt: this.now() + lifetime * 1000 };
  }

  async getPosition(id: string): Promise<AudiotekaRemotePosition | null> {
    const res = await this.request('GET', `/v2/me/playback-progress/${encodeURIComponent(id)}`, {
      allowStatus: [404],
    });
    return res.status === 404 ? null : toRemotePosition(res.data);
  }

  async savePosition(id: string, positionMs: number): Promise<void> {
    await this.command({
      name: 'SavePlaybackProgress',
      audiobook_id: id,
      position: Math.round(positionMs),
      device: DEVICE_NAME,
    });
  }

  async startPlayback(id: string): Promise<void> {
    await this.command({ name: 'StartPlayback', audiobook_id: id });
  }

  private async command(body: Record<string, unknown>): Promise<void> {
    await this.request('POST', '/v2/commands', { body });
  }

  private async get(path: string): Promise<unknown> {
    return (await this.request('GET', path)).data;
  }

  private needsRefresh(): boolean {
    const { token, expiresAt } = this.credentials;
    if (!token) return true;
    if (!expiresAt) return false;
    const expiry = Date.parse(expiresAt);
    return Number.isFinite(expiry) && expiry - this.now() < REFRESH_MARGIN_MS;
  }

  private async doRefresh(): Promise<void> {
    const res = await this.send('POST', '/v2/commands', {
      auth: false,
      body: {
        name: 'RefreshToken',
        refresh_id: this.credentials.refreshId,
        device_id: this.credentials.deviceId,
      },
    });
    if (res.status >= 400 && res.status < 500) {
      this.onCredentialsRejected();
      throw new AudiotekaUnauthorizedError();
    }
    if (res.status >= 400) {
      throw new AudiotekaHttpError(`Audioteka token refresh failed (${res.status})`, res.status);
    }
    const data = res.data;
    if (
      !isRecord(data) ||
      typeof data.token !== 'string' ||
      typeof data.refresh_id !== 'string' ||
      !data.token ||
      !data.refresh_id
    ) {
      throw new Error('Audioteka token refresh returned an unexpected reply');
    }
    this.credentials = {
      ...this.credentials,
      token: data.token,
      refreshId: data.refresh_id,
      expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
    };
    // Persist the rotated refresh id before anything uses the new token.
    this.onCredentialsChanged({ ...this.credentials });
  }

  // Authorised request: refreshes an expiring token first and retries once after a 401.
  private async request(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<ApiResponse> {
    if (this.needsRefresh()) await this.refresh();
    const tokenUsed = this.credentials.token;
    let res = await this.send(method, path, opts);
    if (res.status === 401) {
      // Another caller may already have replaced the rejected token.
      if (this.credentials.token === tokenUsed) await this.refresh();
      res = await this.send(method, path, opts);
    }
    if (res.status >= 400 && !opts.allowStatus?.includes(res.status)) {
      throw new AudiotekaHttpError(`Audioteka request failed (${res.status}) ${path}`, res.status);
    }
    return res;
  }

  private getUserAgent(): Promise<string> {
    if (!this.userAgent) {
      this.userAgent = this.loadAppVersion().then(
        (version) => `Audioteka/${version} (3550) Android/14 (Phone;Pixel 8)`,
      );
    }
    return this.userAgent;
  }

  private async loadAppVersion(): Promise<string> {
    try {
      const res = await this.fetchImpl(`${API_BASE}/v2/apps/config/android`);
      if (!res.ok) return FALLBACK_APP_VERSION;
      const data: unknown = await res.json();
      const config = isRecord(data) ? data.app_version_config : null;
      const version = isRecord(config) ? config.current_version : null;
      return typeof version === 'string' && version ? version : FALLBACK_APP_VERSION;
    } catch {
      return FALLBACK_APP_VERSION;
    }
  }

  private async send(method: string, path: string, opts: RequestOptions): Promise<ApiResponse> {
    const headers: Record<string, string> = {
      'user-agent': await this.getUserAgent(),
      accept: 'application/json',
    };
    if (opts.auth !== false && this.credentials.token) {
      headers.authorization = `Bearer ${this.credentials.token}`;
    }
    const body = opts.body ? JSON.stringify(opts.body) : undefined;
    if (body) headers['content-type'] = 'application/json';

    appLogger.add({
      type: 'http_request',
      message: `[${method}] ${path}`,
      method,
      url: path,
      data: opts.body,
    });

    let res: Response;
    try {
      res = await this.fetchImpl(`${API_BASE}${path}`, { method, headers, body });
    } catch (error) {
      appLogger.add({
        type: 'error',
        message: `[Error N/A] ${path}`,
        method,
        url: path,
        data: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    appLogger.add({
      type: res.status >= 400 ? 'error' : 'http_response',
      message: `[${res.status >= 400 ? `Error ${res.status}` : res.status}] ${path}`,
      status: res.status,
      method,
      url: path,
      // Success bodies carry tokens and signed URLs; keep them out of the log.
      data: res.status >= 400 && opts.auth !== false ? data : undefined,
    });
    return { status: res.status, data };
  }
}
