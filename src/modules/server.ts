import * as path from 'path';
import type { AudiotekaAuthApi, AuthApi } from '../types';
import type { FileResolver } from './mediaProtocol';

export class ServerManager {
  private server: any | null = null;
  private auth: AuthApi | null = null;
  private audiotekaAuth: AudiotekaAuthApi | null = null;
  private mediaResolver: FileResolver | null = null;

  async initialize(): Promise<void> {
    const serverPath = path.join(__dirname, '../../../server/dist/server.js');
    const mod = await import(serverPath);
    // The bundle is CJS: named exports may sit on the module or on `default`.
    const auth: AuthApi | undefined = mod.auth ?? mod.default?.auth;
    if (!auth || typeof auth.login !== 'function') {
      throw new Error(`Server bundle at ${serverPath} does not export \`auth\``);
    }
    const audiotekaAuth: AudiotekaAuthApi | undefined =
      mod.audiotekaAuth ?? mod.default?.audiotekaAuth;
    if (!audiotekaAuth || typeof audiotekaAuth.loginWithCapture !== 'function') {
      throw new Error(`Server bundle at ${serverPath} does not export \`audiotekaAuth\``);
    }
    const mediaResolver: FileResolver | undefined =
      mod.resolveDownloadedFile ?? mod.default?.resolveDownloadedFile;
    if (typeof mediaResolver !== 'function') {
      throw new Error(`Server bundle at ${serverPath} does not export \`resolveDownloadedFile\``);
    }
    this.server = mod.default;
    this.auth = auth;
    this.audiotekaAuth = audiotekaAuth;
    this.mediaResolver = mediaResolver;
  }

  getAuth(): AuthApi {
    if (!this.auth) {
      throw new Error('Server not initialized');
    }
    return this.auth;
  }

  getAudiotekaAuth(): AudiotekaAuthApi {
    if (!this.audiotekaAuth) {
      throw new Error('Server not initialized');
    }
    return this.audiotekaAuth;
  }

  getMediaResolver(): FileResolver {
    if (!this.mediaResolver) {
      throw new Error('Server not initialized');
    }
    return this.mediaResolver;
  }

  async injectRequest(
    method: string,
    url: string,
    payload?: any,
    headers?: Record<string, string>,
  ): Promise<any> {
    if (!this.server) {
      throw new Error('Server not initialized');
    }

    const response = await this.server.inject({
      method,
      url,
      payload,
      headers: headers || {},
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      let errorData: any = {};
      try {
        errorData = response.json();
      } catch {}
      // Return a plain object instead of throwing so that the statusCode
      // survives the Electron IPC structured-clone boundary (custom Error
      // properties are stripped when crossing main→renderer).
      return {
        __isError: true,
        statusCode: response.statusCode,
        error: errorData?.error || `Request failed with status code ${response.statusCode}`,
        data: errorData,
      };
    }

    return {
      data: response.json(),
    };
  }

  getServer(): any | null {
    return this.server;
  }
}
