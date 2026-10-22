import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import api from './utils/api';
import { regionFromLocales } from './config/regions';
import {
  FALLBACK_LANGUAGE,
  negotiateLanguage,
  SUPPORTED_LANGUAGE_CODES,
  systemPreferredLanguages,
} from './config/languages';

export interface LanguageState {
  /** The UI language in use: the OS languages negotiated against the bundled locales. */
  resolved: string;
  /** OS languages, most preferred first (e.g. ['sv-FI', 'en-FI']). */
  systemLanguages: string[];
  /** OS country code ('FI'), i.e. where the user is - not their language. */
  region: string | null;
}

/**
 * Loads `server/locales/<lang>.json` through the API (or Electron IPC).
 *
 * Always asks for a bare language code: the server only ships bare codes, and
 * an unknown tag makes it answer with *every* language bundled together.
 */
class ApiBackend {
  static type = 'backend' as const;

  async read(lang: string, _ns: string, callback: (err: any, data?: any) => void) {
    const code = negotiateLanguage([lang]);
    try {
      const response = await api.get(`/translations?lang=${code}`, {});
      callback(null, response.data);
    } catch (error) {
      // Report the failure so i18next falls through to `fallbackLng`
      // instead of leaving the namespace pending and rendering raw keys.
      callback(error, false);
    }
  }
}

// The UI language is the OS language, resolved synchronously before init so the
// first render is already right. In Electron `navigator.languages` mirrors the OS
// preference list the main process negotiates over, so both sides agree.
const initialLanguage = negotiateLanguage(systemPreferredLanguages());

i18n
  .use(ApiBackend)
  .use(initReactI18next)
  .init({
    lng: initialLanguage,
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    // Bundles are keyed by bare language code; never request 'sv-FI'.
    load: 'languageOnly',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

const applyDocumentLanguage = (lng: string) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
};

applyDocumentLanguage(i18n.language || FALLBACK_LANGUAGE);
i18n.on('languageChanged', applyDocumentLanguage);

/** The language in use plus the OS language list and country, for the search filter. */
export const getLanguageState = async (): Promise<LanguageState> => {
  if (window.electronLocale?.getState) {
    try {
      return await window.electronLocale.getState();
    } catch {
      // Fall through to the renderer-only answer below.
    }
  }
  const systemLanguages = systemPreferredLanguages();
  return {
    resolved: i18n.language || negotiateLanguage(systemLanguages),
    systemLanguages,
    region: regionFromLocales(systemLanguages),
  };
};

export default i18n;
