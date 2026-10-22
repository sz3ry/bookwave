import { app, BrowserWindow, safeStorage } from 'electron';
import { WindowManager } from './modules/window';
import { TrayManager } from './modules/tray';
import { ServerManager } from './modules/server';
import { IpcManager } from './modules/ipc';
import { UpdaterManager } from './modules/updater';
import { AuthManager } from './modules/auth';
import { storeManager } from './modules/store';
import { i18n } from './i18n';

const isDev = process.env.NODE_ENV === 'development';
const isDebug = process.env.IS_DEBUG === 'true';

let windowManager: WindowManager;
let trayManager: TrayManager;
let serverManager: ServerManager;
let ipcManager: IpcManager;
let updaterManager: UpdaterManager;
let authManager: AuthManager;

async function initialize(): Promise<void> {
  process.env.IS_ELECTRON = 'true';
  process.env.DOWNLOAD_PATH = app.getPath('downloads');
  process.env.USER_DATA_PATH = app.getPath('userData');

  windowManager = new WindowManager(isDev, isDebug);
  const mainWindow = windowManager.create();

  serverManager = new ServerManager();
  await serverManager.initialize();

  // Initialize i18n with the Fastify server
  const fastifyServer = serverManager.getServer();
  if (fastifyServer) {
    // Full ordered OS preference list ('sv-FI', 'en-FI', ...) so a user
    // whose first language we don't ship still gets their second choice
    // instead of falling straight through to English.
    i18n.setSystemLanguages([...app.getPreferredSystemLanguages(), app.getLocale()]);
    // Where the user is, which the language alone does not tell us.
    i18n.setRegion(app.getLocaleCountryCode() || null);
    i18n.detectLanguage();
    await i18n.initialize(fastifyServer);
  }

  // Restores stored credentials before the renderer can ask for the auth state.
  authManager = new AuthManager({
    auth: serverManager.getAuth(),
    store: storeManager,
    safeStorage,
    platform: process.platform,
    notifyExpired: () => {
      windowManager.getWindow()?.webContents.send('auth:expired');
    },
  });
  authManager.initialize();

  trayManager = new TrayManager(windowManager);
  trayManager.create();

  ipcManager = new IpcManager(serverManager, trayManager, windowManager, authManager);
  ipcManager.setupHandlers();

  // Initialize auto-updater
  updaterManager = new UpdaterManager(mainWindow, isDev);
  updaterManager.initialize();
}

// Electron only picks a Secret Service keyring on desktops it recognises; on
// others (e.g. niri) it falls back to basic_text and credentials would not be
// persisted. Outside KDE, ask for libsecret explicitly unless the user chose a
// store; with no Secret Service running Electron still falls back to
// basic_text. On KDE Electron's own detection selects KWallet, so leave it be.
const isKde = (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase().includes('KDE');
if (process.platform === 'linux' && !isKde && !app.commandLine.hasSwitch('password-store')) {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // When someone tries to open a second instance, focus the existing window
    if (windowManager) {
      windowManager.show();
    }
  });

  app.whenReady().then(initialize);
}

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', async () => {
  if (app.isQuitting) {
    const window = windowManager.getWindow();
    if (window) {
      await window.webContents.send('tray-play-pause');
    }

    windowManager.killClientProcess();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.create();
  }
});

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});
