import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { LanguageState } from './i18n';
import type { AudiotekaLoginResult, ProvidersState } from './modules/audiotekaAuth';
import type { AuthStateView, LoginResult } from './modules/auth';

// Store API
contextBridge.exposeInMainWorld('electronStore', {
  get: (key: string): Promise<any> => ipcRenderer.invoke('store-get', key),
  remove: (key: string): Promise<void> => ipcRenderer.invoke('store-remove', key),
  set: (key: string, value: any): Promise<void> => ipcRenderer.invoke('store-set', key, value),
});

// Auth API: the renderer never sees the credentials, only the state.
contextBridge.exposeInMainWorld('electronAuth', {
  login: (email: string, password: string): Promise<LoginResult> =>
    ipcRenderer.invoke('auth:login', email, password),
  logout: (): Promise<void> => ipcRenderer.invoke('auth:logout'),
  getState: (): Promise<AuthStateView> => ipcRenderer.invoke('auth:state'),
  getProviders: (): Promise<ProvidersState> => ipcRenderer.invoke('auth:providers'),
  // Opens the audioteka.com login window; resolves once it is done or closed.
  audiotekaLogin: (): Promise<AudiotekaLoginResult> => ipcRenderer.invoke('auth:audioteka-login'),
  audiotekaLogout: (): Promise<void> => ipcRenderer.invoke('auth:audioteka-logout'),
  // A provider rejected its stored credentials; returns an unsubscribe function.
  onExpired: (callback: (provider: 'storytel' | 'audioteka') => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, provider: 'storytel' | 'audioteka') =>
      callback(provider);
    ipcRenderer.on('auth:expired', listener);
    return () => {
      ipcRenderer.removeListener('auth:expired', listener);
    };
  },
});

// Locale API
contextBridge.exposeInMainWorld('electronLocale', {
  // The language in use plus the OS preference list and country.
  getState: (): Promise<LanguageState> => ipcRenderer.invoke('get-locale-state'),
});

// Window API
contextBridge.exposeInMainWorld('electronWindow', {
  setAlwaysOnTop: (alwaysOnTop: boolean): Promise<void> =>
    ipcRenderer.invoke('window-set-always-on-top', alwaysOnTop),
  isAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke('window-is-always-on-top'),
});

// Tray Controls API
contextBridge.exposeInMainWorld('trayControls', {
  onPlayPause: (callback: () => void): void => {
    ipcRenderer.on('tray-play-pause', callback);
  },
  onSetSpeed: (callback: (_event: IpcRendererEvent, speed: number) => void): void => {
    ipcRenderer.on('tray-set-speed', callback);
  },
  onLogout: (callback: () => void): void => {
    ipcRenderer.on('tray-logout', callback);
  },
  updatePlayingState: (isPlaying: boolean, bookTitle: string): void => {
    ipcRenderer.send('update-playing-state', { isPlaying, bookTitle });
  },
  updateAuthState: (isAuthenticated: boolean): void => {
    ipcRenderer.send('update-auth-state', { isAuthenticated });
  },
});

// Logs API
contextBridge.exposeInMainWorld('electronLogs', {
  openLogsFolder: (): Promise<void> => ipcRenderer.invoke('open-logs-folder'),
});

// Electron API
interface ApiConfig {
  headers?: Record<string, string>;
}

contextBridge.exposeInMainWorld('electronApi', {
  get: (url: string, _: any, config?: ApiConfig): Promise<any> =>
    ipcRenderer.invoke('api:get', url, config),
  post: (url: string, data: any, config?: ApiConfig): Promise<any> =>
    ipcRenderer.invoke('api:post', url, data, config),
  put: (url: string, data: any, config?: ApiConfig): Promise<any> =>
    ipcRenderer.invoke('api:put', url, data, config),
  delete: (url: string, _: any, config?: ApiConfig): Promise<any> =>
    ipcRenderer.invoke('api:delete', url, config),
});
