import Fastify from 'fastify';
import dotenv from 'dotenv';
import path from 'path';
import type { FetchLike } from './http';
import { appLogger } from './logger';
import { AudiotekaClient } from './audioteka/client';
import { audiotekaRoutes } from './audioteka/routes';
import { type AudiotekaAuthApi, createAudiotekaSession } from './audioteka/session';
import StorytelClient from './storytel/client';
import { createStorytelDownloads, requireStorytelSession, storytelRoutes } from './storytel/routes';
import { type AuthApi, createSession } from './storytel/session';

dotenv.config({
  quiet: true,
});

const DOWNLOADS_DIR = process.env.IS_ELECTRON
  ? '' + process.env.DOWNLOAD_PATH
  : path.join(__dirname, 'downloads');

// Downloaded Storytel books; creates the downloads directory if needed.
const storytelDownloads = createStorytelDownloads(
  DOWNLOADS_DIR,
  path.join(process.env.USER_DATA_PATH || process.cwd(), 'downloads-index.json'),
);

// Used by the Electron main process to serve downloaded books over its media
// protocol; returns null for anything that is not a downloaded book id.
export function resolveDownloadedFile(bookId: string): string | null {
  return storytelDownloads.findDownloadedFile(bookId);
}

const fastify = Fastify({ logger: process.env.NODE_ENV !== 'production' });

// Fetch used by the session's Storytel client; only tests replace it.
let sessionFetch: FetchLike | undefined;

// Test seam: storytel/routes.test.ts injects a fetch stub here before restoring a
// session. Takes effect for clients created afterwards (login/restore).
export function configureSessionForTests(options: { fetch?: FetchLike }): void {
  sessionFetch = options.fetch;
}

// The logged-in account. The Electron main process drives it in-process
// through `auth`; there is no login route, so the renderer cannot reach it.
const session = createSession((opts) => new StorytelClient({ ...opts, fetch: sessionFetch }));

export const auth: AuthApi = session;

// Fetch used by the Audioteka client; only tests replace it.
let audiotekaFetch: FetchLike | undefined;

export function configureAudiotekaForTests(options: { fetch?: FetchLike }): void {
  audiotekaFetch = options.fetch;
}

// The logged-in Audioteka account, driven by the main process like `auth`.
const audiotekaSession = createAudiotekaSession(
  (opts) => new AudiotekaClient({ ...opts, fetch: audiotekaFetch }),
);

export const audiotekaAuth: AudiotekaAuthApi = audiotekaSession;

// The logs routes are gated by the Storytel session as well.
const requireSession = requireStorytelSession(session);

fastify.register(storytelRoutes(session, storytelDownloads));

// Locale loaders keyed by language code. The import paths are written out
// literally so esbuild can bundle every locale into the server build - a
// computed `import("./locales/" + code)` is not resolvable at build time.
//
// Adding a language? Add the JSON file here and mirror it in
// `client/src/config/languages.ts` and `src/i18n/languages.ts`.
const LOCALE_LOADERS = {
  de: () => import('./locales/de.json'),
  en: () => import('./locales/en.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  it: () => import('./locales/it.json'),
  pl: () => import('./locales/pl.json'),
  fi: () => import('./locales/fi.json'),
  sv: () => import('./locales/sv.json'),
} as const;

type SupportedLanguage = keyof typeof LOCALE_LOADERS;

const SUPPORTED_LANGUAGES = Object.keys(LOCALE_LOADERS) as SupportedLanguage[];

const loadLocale = async (code: SupportedLanguage) => (await LOCALE_LOADERS[code]()).default;

fastify.get<{
  Querystring: { lang?: string };
}>('/api/translations', async (request, reply) => {
  try {
    const { lang } = request.query;

    // Accept region variants and odd casing ("sv-FI", "SV", "sv_FI" -> "sv").
    // Without this a locale like sv-FI fell through to the "every language"
    // branch below, which i18next then loaded as a single unusable bundle.
    const requested = (lang ?? '').trim().toLowerCase().replace(/_/g, '-');
    const base = requested.split('-')[0];
    const match = SUPPORTED_LANGUAGES.find((code) => code === requested || code === base);

    if (match) {
      const translations = await loadLocale(match);
      reply.header('Content-Language', match);
      reply.send(translations);
    } else {
      // No usable `lang`: hand back every bundle, keyed by language code.
      const bundles = await Promise.all(
        SUPPORTED_LANGUAGES.map(async (code) => [code, await loadLocale(code)] as const),
      );
      reply.send(Object.fromEntries(bundles));
    }
  } catch (error: any) {
    reply.code(500).send({ error: 'Failed to load translations' });
  }
});

fastify.get(
  '/api/logs',
  {
    preHandler: requireSession,
  },
  async (_request, reply) => {
    reply.send(appLogger.getLogs());
  },
);

fastify.delete(
  '/api/logs',
  {
    preHandler: requireSession,
  },
  async (_request, reply) => {
    appLogger.clearLogs();
    reply.send({ success: true });
  },
);

fastify.post<{ Body: { message: string; data?: any } }>(
  '/api/logs/action',
  {
    preHandler: requireSession,
  },
  async (request, reply) => {
    appLogger.add({
      type: 'action',
      message: request.body.message,
      data: request.body.data,
    });
    reply.send({ success: true });
  },
);

fastify.register(audiotekaRoutes(audiotekaSession));

export default fastify;
