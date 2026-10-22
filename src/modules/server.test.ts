import { describe, expect, test } from 'bun:test';
import { ServerManager } from './server';

type InjectReply = { statusCode: number; payload: string; json(): unknown };

const reply = (statusCode: number, body: string): InjectReply => ({
  statusCode,
  payload: body,
  json: () => JSON.parse(body),
});

const managerWith = (inject: (opts: unknown) => Promise<InjectReply>): ServerManager => {
  const manager = new ServerManager();
  (manager as unknown as { server: unknown }).server = { inject };
  return manager;
};

describe('ServerManager', () => {
  test('answers a 204 with null data', async () => {
    const manager = managerWith(async () => reply(204, ''));
    expect(await manager.injectRequest('PUT', '/api/x', { position: 1 })).toEqual({ data: null });
  });

  test('parses a JSON body', async () => {
    const manager = managerWith(async () => reply(200, '{"a":1}'));
    expect(await manager.injectRequest('GET', '/api/x')).toEqual({ data: { a: 1 } });
  });

  test('settle waits for requests still running', async () => {
    let finish!: () => void;
    const manager = managerWith(
      () =>
        new Promise<InjectReply>((resolve) => {
          finish = () => resolve(reply(204, ''));
        }),
    );
    void manager.injectRequest('PUT', '/api/x');
    let settled = false;
    const settling = manager.settle(1000).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    finish();
    await settling;
    expect(settled).toBe(true);
  });

  test('settle gives up after the timeout', async () => {
    const manager = managerWith(() => new Promise<InjectReply>(() => {}));
    void manager.injectRequest('PUT', '/api/x');
    const started = Date.now();
    await manager.settle(20);
    expect(Date.now() - started).toBeLessThan(500);
  });

  test('settle returns at once with nothing running', async () => {
    await new ServerManager().settle(10_000);
  });
});
