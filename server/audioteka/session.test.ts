import { describe, expect, test } from 'bun:test';
import type { AudiotekaClient, AudiotekaClientOptions, AudiotekaCredentials } from './client';
import { createAudiotekaSession } from './session';

const capture = { deviceId: 'd', refreshId: 'r0' };
const stored: AudiotekaCredentials = {
  deviceId: 'd',
  refreshId: 'r1',
  token: 't',
  expiresAt: '2027-01-01T00:00:00+00:00',
};

// A client stand-in whose refresh rotates the refresh id and can be held open.
function fakeFactory() {
  const created: { opts: AudiotekaClientOptions; release: () => void; fail: () => void }[] = [];
  const factory = (opts: AudiotekaClientOptions) => {
    let release = () => {};
    let fail = () => {};
    const gate = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = () => reject(new Error('refresh failed'));
    });
    const instance = {
      refresh: async () => {
        await gate;
        opts.onCredentialsChanged({
          ...opts.credentials,
          refreshId: 'rotated',
          token: 'fresh',
          expiresAt: '2027-04-01T00:00:00+00:00',
        });
      },
    } as unknown as AudiotekaClient;
    created.push({ opts, release, fail });
    return instance;
  };
  return { factory, created };
}

describe('createAudiotekaSession', () => {
  test('loginWithCapture refreshes, notifies synchronously and resolves with the new credentials', async () => {
    const { factory, created } = fakeFactory();
    const session = createAudiotekaSession(factory);
    const seen: AudiotekaCredentials[] = [];
    session.onCredentialsChanged((c) => seen.push(c));

    const login = session.loginWithCapture(capture);
    expect(created[0].opts.credentials.token).toBeNull();
    created[0].release();
    const creds = await login;

    expect(creds.refreshId).toBe('rotated');
    expect(seen).toEqual([creds]);
    expect(session.getState()).toEqual({ loggedIn: true });
    expect(session.getClient()).not.toBeNull();
  });

  test('a login overtaken by logout is dropped and not persisted', async () => {
    const { factory, created } = fakeFactory();
    const session = createAudiotekaSession(factory);
    const seen: AudiotekaCredentials[] = [];
    session.onCredentialsChanged((c) => seen.push(c));

    const login = session.loginWithCapture(capture);
    session.logout();
    created[0].release();

    await expect(login).rejects.toThrow('Login superseded');
    expect(seen).toEqual([]);
    expect(session.getState().loggedIn).toBe(false);
  });

  test('a current client keeps persisting rotations while a second login is in flight', async () => {
    const { factory, created } = fakeFactory();
    const session = createAudiotekaSession(factory);
    const seen: string[] = [];
    session.onCredentialsChanged((c) => seen.push(c.refreshId));

    const first = session.loginWithCapture(capture);
    created[0].release();
    await first;
    const clientA = session.getClient();
    seen.length = 0;

    const second = session.loginWithCapture({ deviceId: 'd2', refreshId: 'x' });
    created[0].opts.onCredentialsChanged({ ...stored, refreshId: 'a-rotated' });
    expect(seen).toEqual(['a-rotated']);

    created[1].fail();
    await expect(second).rejects.toThrow('refresh failed');
    expect(session.getClient()).toBe(clientA);
    expect(session.getState().loggedIn).toBe(true);
  });

  test('a later login supersedes an earlier one', async () => {
    const { factory, created } = fakeFactory();
    const session = createAudiotekaSession(factory);
    const first = session.loginWithCapture(capture);
    const second = session.loginWithCapture({ deviceId: 'd2', refreshId: 'x' });
    created[0].release();
    created[1].release();
    await expect(first).rejects.toThrow('Login superseded');
    expect((await second).deviceId).toBe('d2');
  });

  test('rejected credentials log out and notify listeners', () => {
    const { factory, created } = fakeFactory();
    const session = createAudiotekaSession(factory);
    let rejected = 0;
    session.onCredentialsRejected(() => rejected++);
    session.restore(stored);
    expect(session.getState().loggedIn).toBe(true);

    created[0].opts.onCredentialsRejected();
    expect(rejected).toBe(1);
    expect(session.getState().loggedIn).toBe(false);
  });

  test('a replaced client cannot end the current session', () => {
    const { factory, created } = fakeFactory();
    const session = createAudiotekaSession(factory);
    let rejected = 0;
    session.onCredentialsRejected(() => rejected++);
    session.restore(stored);
    session.restore({ ...stored, refreshId: 'r2' });

    created[0].opts.onCredentialsRejected();
    expect(rejected).toBe(0);
    expect(session.getState().loggedIn).toBe(true);
  });

  test('restored client forwards credential changes to listeners', () => {
    const { factory, created } = fakeFactory();
    const session = createAudiotekaSession(factory);
    const seen: string[] = [];
    const off = session.onCredentialsChanged((c) => seen.push(c.refreshId));
    session.restore(stored);
    created[0].opts.onCredentialsChanged({ ...stored, refreshId: 'n1' });
    off();
    created[0].opts.onCredentialsChanged({ ...stored, refreshId: 'n2' });
    expect(seen).toEqual(['n1']);
  });
});
