import { ipcMain, type IpcMainInvokeEvent, shell } from 'electron';
import path from 'path';
import { storeManager } from './store';
import { type AuthManager, createAuthIpcHandlers, isProtectedStoreKey } from './auth';
import { type AudiotekaAuthManager, createAudiotekaIpcHandlers } from './audiotekaAuth';
import type { ServerManager } from './server';
import type { TrayManager } from './tray';
import type { WindowManager } from './window';
import type { ApiConfig } from '../types';
import { i18n } from '../i18n';

export class IpcManager {
  private serverManager: ServerManager;
  private trayManager: TrayManager;
  private windowManager: WindowManager;

  constructor(
    serverManager: ServerManager,
    trayManager: TrayManager,
    windowManager: WindowManager,
  ) {
    this.serverManager = serverManager;
    this.trayManager = trayManager;
    this.windowManager = windowManager;
  }

  // Registered before the window loads, ahead of the other handlers: the
  // renderer asks for the auth state first thing, while main is still
  // starting the server and restoring the stored credentials.
  static setupAuthHandlers(
    authReady: Promise<AuthManager>,
    audiotekaReady: Promise<AudiotekaAuthManager>,
  ): void {
    const handlers = createAuthIpcHandlers(authReady);
    ipcMain.handle('auth:login', (_event: IpcMainInvokeEvent, email: unknown, password: unknown) =>
      handlers.login(email, password),
    );
    ipcMain.handle('auth:logout', () => handlers.logout());
    ipcMain.handle('auth:state', () => handlers.state());

    const audioteka = createAudiotekaIpcHandlers(authReady, audiotekaReady);
    ipcMain.handle('auth:providers', () => audioteka.providers());
    ipcMain.handle('auth:audioteka-login', () => audioteka.login());
    ipcMain.handle('auth:audioteka-logout', () => audioteka.logout());
  }

  setupHandlers(): void {
    this.setupStoreHandlers();
    this.setupApiHandlers();
    this.setupTrayHandlers();
    this.setupLocaleHandlers();
    this.setupWindowHandlers();
    this.setupLogsHandlers();
  }

  private setupStoreHandlers(): void {
    // The credentials live under `auth`; only the auth IPC below touches them.
    // A non-string key is refused too: electron-store reads the whole store
    // for a missing key and writes several keys from an object.
    const isAllowed = (key: unknown): key is string =>
      typeof key === 'string' && !isProtectedStoreKey(key);

    ipcMain.handle('store-get', (_event: IpcMainInvokeEvent, key: unknown) => {
      return isAllowed(key) ? storeManager.get(key) : undefined;
    });

    ipcMain.handle('store-set', (_event: IpcMainInvokeEvent, key: unknown, value: any) => {
      if (isAllowed(key)) storeManager.set(key, value);
    });

    ipcMain.handle('store-remove', (_event: IpcMainInvokeEvent, key: unknown) => {
      if (isAllowed(key)) storeManager.remove(key);
    });
  }

  private setupApiHandlers(): void {
    ipcMain.handle(
      'api:get',
      async (_event: IpcMainInvokeEvent, url: string, config: ApiConfig = {}) => {
        return await this.serverManager.injectRequest('GET', url, undefined, config?.headers);
      },
    );

    ipcMain.handle(
      'api:post',
      async (_event: IpcMainInvokeEvent, url: string, data: any = {}, config: ApiConfig = {}) => {
        return await this.serverManager.injectRequest('POST', url, data, config?.headers);
      },
    );

    ipcMain.handle(
      'api:put',
      async (_event: IpcMainInvokeEvent, url: string, data: any = {}, config: ApiConfig = {}) => {
        return await this.serverManager.injectRequest('PUT', url, data, config?.headers);
      },
    );

    ipcMain.handle(
      'api:delete',
      async (_event: IpcMainInvokeEvent, url: string, config: ApiConfig = {}) => {
        return await this.serverManager.injectRequest('DELETE', url, undefined, config?.headers);
      },
    );
  }

  private setupTrayHandlers(): void {
    ipcMain.on(
      'update-playing-state',
      (_event, { isPlaying, bookTitle }: { isPlaying: boolean; bookTitle: string }) => {
        this.trayManager.updatePlayingState({ isPlaying, bookTitle });
      },
    );

    ipcMain.on('update-auth-state', (_event, { isAuthenticated }: { isAuthenticated: boolean }) => {
      this.trayManager.updatePlayingState({ isAuthenticated });
    });
  }

  private setupLocaleHandlers(): void {
    // The language in use and the OS language list / country, for the search filter.
    ipcMain.handle('get-locale-state', () => {
      return i18n.getState();
    });
  }

  private setupLogsHandlers(): void {
    ipcMain.handle('open-logs-folder', () => {
      const logPath = path.join(process.env.USER_DATA_PATH || '', 'app.log');
      shell.showItemInFolder(logPath);
    });
  }

  private setupWindowHandlers(): void {
    ipcMain.handle(
      'window-set-always-on-top',
      (_event: IpcMainInvokeEvent, alwaysOnTop: boolean) => {
        this.windowManager.setAlwaysOnTop(alwaysOnTop);
      },
    );

    ipcMain.handle('window-is-always-on-top', () => {
      return this.windowManager.isAlwaysOnTop();
    });
  }
}
