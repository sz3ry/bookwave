import * as dot from 'dot-object';
import {
  FALLBACK_LANGUAGE,
  resolveUiLanguage,
  type SupportedLanguage,
  SUPPORTED_LANGUAGES,
} from './languages';

interface Translations {
  [key: string]: any;
}

export type { SupportedLanguage };
export { SUPPORTED_LANGUAGES };

/** What the renderer needs to know about the language and where the user is. */
export interface LanguageState {
  /** The UI language in use: the OS languages negotiated against the bundled locales. */
  resolved: SupportedLanguage;
  /** OS languages, most preferred first (e.g. ['sv-FI', 'en-FI']). */
  systemLanguages: string[];
  /** OS country code ('FI'), i.e. where the user is - not their language. */
  region: string | null;
}

class I18n {
  private currentLanguage: SupportedLanguage = FALLBACK_LANGUAGE;
  public translations: Translations = {};
  private fastifyServer: any = null;
  /** OS preferred languages, most preferred first. */
  private systemLanguages: string[] = [];
  /** OS country code, from `app.getLocaleCountryCode()`. */
  private region: string | null = null;

  /**
   * @param locales OS languages, most preferred first. Electron's
   * `app.getPreferredSystemLanguages()` returns the full ordered list
   * (e.g. ['sv-FI', 'en-FI']); `app.getLocale()` only returns the first one
   * already collapsed to a Chromium UI locale, which loses the user's
   * second choice.
   */
  public setSystemLanguages(locales: string[] | string): void {
    const list = (Array.isArray(locales) ? locales : [locales]).filter(Boolean);
    this.systemLanguages = [...new Set(list)];
  }

  /**
   * The country the user is in, which is independent of their language:
   * a `sv-FI` locale means "Swedish speaker in Finland".
   */
  public setRegion(region: string | null): void {
    this.region = region ? region.toUpperCase() : null;
  }

  async initialize(server: any): Promise<void> {
    this.fastifyServer = server;
    await this.loadTranslations();
  }

  /** The UI language follows the OS: OS preferences, then APP_LOCALE, then English. */
  public detectLanguage(): void {
    this.currentLanguage = resolveUiLanguage(this.systemLanguages, process.env.APP_LOCALE);
  }

  public getState(): LanguageState {
    return {
      resolved: this.currentLanguage,
      systemLanguages: [...this.systemLanguages],
      region: this.region,
    };
  }

  private async loadTranslations(): Promise<void> {
    if (!this.fastifyServer) {
      console.error('Fastify server not initialized');
      return;
    }

    try {
      const response = await this.fastifyServer.inject({
        method: 'GET',
        url: `/api/translations?lang=${this.currentLanguage}`,
      });

      this.translations = response.json();
    } catch (error) {
      console.error('Failed to load translations:', error);
    }
  }

  t(key: string): string {
    const value = dot.pick(key, this.translations) || key;
    return typeof value === 'string' ? value : key;
  }

  getLanguage(): SupportedLanguage {
    return this.currentLanguage;
  }
}

export const i18n = new I18n();
