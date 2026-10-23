import type { FetchLike } from '../http';
import { appLogger, maskSecrets } from '../logger';

export type { FetchLike };

export const STORYTEL_APP_VERSION = '25.38.0';

export const STORYTEL_BASE_HEADERS: Record<string, string> = {
  'x-storytel-terminal': 'ios',
  'user-agent': 'Storytel/25.38.0 (iOS 26.0; iPhone16,2) Release/924.1',
};

const DEFAULT_TIMEOUT_MS = 30000;

export class StorytelHttpError extends Error {
  status: number;
  data: unknown;
  headers: Headers;

  constructor(message: string, status: number, data: unknown, headers: Headers) {
    super(message);
    this.name = 'StorytelHttpError';
    this.status = status;
    this.data = data;
    this.headers = headers;
  }
}

export class StorytelAuthError extends StorytelHttpError {
  readonly isStorytelUnauthorized = true;
  isLoginFailure: boolean;
  storytelStatus: number;
  storytelData: unknown;

  constructor(message: string, data: unknown, headers: Headers, isLoginFailure = false) {
    super(message, 401, data, headers);
    this.name = 'StorytelAuthError';
    this.isLoginFailure = isLoginFailure;
    this.storytelStatus = 401;
    this.storytelData = data;
  }
}

export interface StorytelRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Absolute URL. */
  url: string;
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  /** Encoding is always explicit, never inferred. */
  body?: { form: string } | { json: unknown };
  signal?: AbortSignal;
  /** Defaults to 30000. */
  timeoutMs?: number;
}

export interface StorytelResponse<T> {
  status: number;
  headers: Headers;
  data: T;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  const trimmed = text.trim();
  // Parse JSON-looking bodies even when the content-type is wrong.
  if (
    text &&
    (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('['))
  ) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export function createStorytelFetch(
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): <T = any>(req: StorytelRequest) => Promise<StorytelResponse<T>> {
  return async <T = any>(req: StorytelRequest): Promise<StorytelResponse<T>> => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    url.searchParams.set('version', STORYTEL_APP_VERSION);

    const headers = new Headers(STORYTEL_BASE_HEADERS);
    for (const [key, value] of Object.entries(req.headers ?? {})) {
      headers.set(key, value);
    }
    let body: string | undefined;
    if (req.body) {
      if ('form' in req.body) {
        body = req.body.form;
        headers.set('content-type', 'application/x-www-form-urlencoded');
      } else {
        body = JSON.stringify(req.body.json);
        headers.set('content-type', 'application/json');
      }
    }

    const timeout = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;

    const cleanUrl = maskSecrets(url.toString());
    // login.action replies carry the session tokens; never log their body.
    const isLogin = url.pathname.includes('login.action');
    const logData = (data: unknown) => (isLogin ? '[redacted]' : data);
    appLogger.add({
      type: 'http_request',
      message: `[${method}] ${cleanUrl}`,
      method,
      url: cleanUrl,
      data: body,
    });

    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers, body, redirect: 'manual', signal });
    } catch (error) {
      appLogger.add({
        type: 'error',
        message: `[Error N/A] ${cleanUrl}`,
        method,
        url: cleanUrl,
        data: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const data = await parseBody(res);

    if (res.status >= 400) {
      appLogger.add({
        type: 'error',
        message: `[Error ${res.status}] ${cleanUrl}`,
        status: res.status,
        method,
        url: cleanUrl,
        data: logData(data),
      });
      if (res.status === 401) {
        throw new StorytelAuthError(
          isLogin ? 'Storytel login rejected' : 'Storytel session expired',
          data,
          res.headers,
          isLogin,
        );
      }
      throw new StorytelHttpError(
        `Request failed with status code ${res.status}`,
        res.status,
        data,
        res.headers,
      );
    }

    appLogger.add({
      type: 'http_response',
      message: `[${res.status}] ${cleanUrl}`,
      status: res.status,
      method,
      url: cleanUrl,
      data: logData(data),
    });
    return { status: res.status, headers: res.headers, data: data as T };
  };
}
