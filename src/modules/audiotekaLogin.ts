// Only type imports from electron at the top level, so parseAuthenticateRequest
// runs under `bun test`; the window code loads electron when it is called.
import type { BrowserWindow, Session } from 'electron';
import type { AudiotekaLoginCapture } from '../types';

const LOGIN_URL = 'https://audioteka.com/pl/';
const COMMANDS_PATH = '/v2/commands';
// httpOnly cookie the site sets on a successful web login; RefreshToken accepts it.
const REFRESH_COOKIE = 'api_refresh_token';

// The web login posts {name:"AuthenticateForWeb", device_id, email, password,
// catalog_id, recaptcha_token}. Only the device id is kept: refreshes must use
// the device the login registered.
export function parseAuthenticateRequest(
  postData: string | undefined,
): { deviceId: string } | null {
  if (!postData) return null;
  let body: unknown;
  try {
    body = JSON.parse(postData);
  } catch {
    return null;
  }
  const b = body as { name?: unknown; device_id?: unknown } | null;
  if (typeof b !== 'object' || b === null || b.name !== 'AuthenticateForWeb') return null;
  if (typeof b.device_id !== 'string' || b.device_id === '') return null;
  return { deviceId: b.device_id };
}

function isCommandsRequest(url: string, method: string): boolean {
  if (method !== 'POST') return false;
  try {
    return new URL(url).pathname.endsWith(COMMANDS_PATH);
  } catch {
    return false;
  }
}

async function readRefreshCookie(ses: Session): Promise<string | null> {
  const cookies = await ses.cookies.get({ name: REFRESH_COOKIE });
  const cookie = cookies.find((c) => c.domain?.endsWith('audioteka.com') && c.value);
  // The site may store the value URL-encoded.
  return cookie ? decodeURIComponent(cookie.value) : null;
}

interface CdpRequest {
  url: string;
  method: string;
  postData?: string;
  hasPostData?: boolean;
}

// The login in progress, so a second request focuses its window instead of
// opening another one.
let pending: Promise<AudiotekaLoginCapture | null> | null = null;
let pendingWindow: BrowserWindow | null = null;

// Opens audioteka.com in a modal window on a throwaway in-memory session and
// waits for the user to log in there (the site needs reCAPTCHA, so the app
// cannot post the credentials itself). Watches the page's network traffic
// through the DevTools protocol: once the AuthenticateForWeb command succeeds,
// takes the device id from its request body and the refresh id from the
// cookie it set, then closes the window. Resolves null when the user closes
// the window; rejects when the login succeeded but no refresh id was set.
// The ids are never logged.
export function openAudiotekaLogin(
  parent: BrowserWindow | null,
): Promise<AudiotekaLoginCapture | null> {
  if (pending) {
    if (pendingWindow && !pendingWindow.isDestroyed()) pendingWindow.focus();
    return pending;
  }
  const result = runLoginWindow(parent, (window) => {
    pendingWindow = window;
  }).finally(() => {
    pending = null;
    pendingWindow = null;
  });
  pending = result;
  return result;
}

async function runLoginWindow(
  parent: BrowserWindow | null,
  onWindow: (window: BrowserWindow) => void,
): Promise<AudiotekaLoginCapture | null> {
  const { BrowserWindow, session } = await import('electron');
  // In memory (no `persist:` prefix) and unique per login: nothing from an
  // earlier attempt leaks in, and nothing outlives the app.
  const ses = session.fromPartition(`audioteka-login-${Date.now()}`);
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    parent: parent ?? undefined,
    modal: parent !== null,
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  onWindow(win);

  return new Promise<AudiotekaLoginCapture | null>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      settle();
      if (!win.isDestroyed()) win.close();
    };

    win.on('closed', () => {
      finish(() => resolve(null));
      // Drop the site's cookies (including the short-lived bearer) right away.
      ses.clearStorageData().catch(() => {});
    });

    // Sign-in popups (e.g. a social login) load in this instrumented window.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) win.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });

    const dbg = win.webContents.debugger;
    // requestId -> device id (null when not a web login) of a /v2/commands
    // request; set synchronously so the response events can never outrun it.
    const commands = new Map<string, Promise<string | null>>();
    const statuses = new Map<string, number>();

    const readDeviceId = async (requestId: string, request: CdpRequest) => {
      let postData = request.postData;
      if (postData === undefined && request.hasPostData) {
        // Bodies the event leaves out must be fetched separately.
        const reply = (await dbg
          .sendCommand('Network.getRequestPostData', { requestId })
          .catch(() => null)) as { postData?: string } | null;
        postData = reply?.postData;
      }
      return parseAuthenticateRequest(postData)?.deviceId ?? null;
    };

    const onFinished = async (requestId: string) => {
      const command = commands.get(requestId);
      const status = statuses.get(requestId);
      commands.delete(requestId);
      statuses.delete(requestId);
      if (!command) return;
      const deviceId = await command;
      // A wrong password answers 4xx: leave the window open for another try.
      if (deviceId === null || status === undefined || status < 200 || status >= 300) return;
      const refreshId = await readRefreshCookie(ses);
      if (!refreshId) {
        finish(() => reject(new Error('Audioteka login did not set a refresh cookie')));
        return;
      }
      finish(() => resolve({ deviceId, refreshId }));
    };

    dbg.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        const request = params.request as CdpRequest;
        if (isCommandsRequest(request.url, request.method)) {
          commands.set(
            params.requestId,
            readDeviceId(params.requestId, request).catch(() => null),
          );
        }
      } else if (method === 'Network.responseReceived' && commands.has(params.requestId)) {
        statuses.set(params.requestId, params.response.status);
      } else if (method === 'Network.loadingFinished') {
        onFinished(params.requestId).catch((error) => finish(() => reject(error)));
      } else if (method === 'Network.loadingFailed') {
        commands.delete(params.requestId);
        statuses.delete(params.requestId);
      }
    });

    const attach = async () => {
      // Network.enable fails on a target that has not loaded anything yet.
      await win.loadURL('about:blank');
      dbg.attach('1.3');
      await dbg.sendCommand('Network.enable');
    };
    attach()
      .then(() =>
        // A redirect or the user navigating away aborts this load; the page
        // (or Chromium's error page) stays usable, so it is not a failure.
        win.loadURL(LOGIN_URL).catch((error) => {
          console.warn('Audioteka login page did not finish loading:', error?.code ?? error);
        }),
      )
      .catch((error) => {
        // Closing the window during setup is a cancel, not a failure.
        if (win.isDestroyed()) return;
        finish(() => reject(error));
      });
  });
}
