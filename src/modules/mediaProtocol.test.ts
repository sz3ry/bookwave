import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleMediaRequest, MEDIA_SCHEME, parseRange, registerMediaScheme } from './mediaProtocol';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookwave-media-'));
const BOOK_ID = '5134609';
const filePath = path.join(tmpDir, `Lalka [${BOOK_ID}].mp3`);
const content = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
fs.writeFileSync(filePath, content);

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function resolverFor(map: Record<string, string>) {
  const calls: string[] = [];
  const resolve = (bookId: string) => {
    calls.push(bookId);
    return map[bookId] ?? null;
  };
  return { resolve, calls };
}

const bookUrl = (bookId: string) => `${MEDIA_SCHEME}://book/${bookId}`;

describe('parseRange', () => {
  test('parses a closed range', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
  });

  test('parses an open-ended range', () => {
    expect(parseRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 });
  });

  test('parses a suffix range', () => {
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  test('clamps a suffix longer than the file to the whole file', () => {
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  test('clamps the end to the last byte', () => {
    expect(parseRange('bytes=500-5000', 1000)).toEqual({ start: 500, end: 999 });
  });

  test('reports a start past the end of the file as unsatisfiable', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=2000-2100', 1000)).toBe('unsatisfiable');
  });

  test('reports a start after the end as unsatisfiable', () => {
    expect(parseRange('bytes=200-100', 1000)).toBe('unsatisfiable');
  });

  test('ignores missing, malformed and multi-range headers', () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('', 1000)).toBeNull();
    expect(parseRange('garbage', 1000)).toBeNull();
    expect(parseRange('bytes=abc-def', 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
    expect(parseRange('items=0-10', 1000)).toBeNull();
    expect(parseRange('bytes=0-10,20-30', 1000)).toBeNull();
  });
});

describe('handleMediaRequest', () => {
  test('serves the requested byte range with 206', async () => {
    const { resolve } = resolverFor({ [BOOK_ID]: filePath });
    const response = await handleMediaRequest(
      new Request(bookUrl(BOOK_ID), { headers: { Range: 'bytes=10-19' } }),
      resolve,
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 10-19/1000');
    expect(response.headers.get('Content-Length')).toBe('10');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(content.subarray(10, 20))).toBe(true);
  });

  test('serves the whole file with 200 when there is no range', async () => {
    const { resolve } = resolverFor({ [BOOK_ID]: filePath });
    const response = await handleMediaRequest(new Request(bookUrl(BOOK_ID)), resolve);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Range')).toBeNull();
    expect(response.headers.get('Content-Length')).toBe('1000');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(content)).toBe(true);
  });

  test('answers an unsatisfiable range with 416', async () => {
    const { resolve } = resolverFor({ [BOOK_ID]: filePath });
    const response = await handleMediaRequest(
      new Request(bookUrl(BOOK_ID), { headers: { Range: 'bytes=5000-' } }),
      resolve,
    );

    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */1000');
  });

  test('rejects a non-numeric book id without consulting the resolver', async () => {
    const { resolve, calls } = resolverFor({ [BOOK_ID]: filePath });

    for (const url of [
      `${MEDIA_SCHEME}://book/..%2Fetc`,
      `${MEDIA_SCHEME}://book/../etc`,
      `${MEDIA_SCHEME}://book/12a`,
      `${MEDIA_SCHEME}://book/`,
      `${MEDIA_SCHEME}://book/${BOOK_ID}/extra`,
      `${MEDIA_SCHEME}://other/${BOOK_ID}`,
    ]) {
      const response = await handleMediaRequest(new Request(url), resolve);
      expect(response.status).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  test('answers an unknown book with 404', async () => {
    const { resolve, calls } = resolverFor({});
    const response = await handleMediaRequest(new Request(bookUrl('42')), resolve);

    expect(response.status).toBe(404);
    expect(calls).toEqual(['42']);
  });

  test('answers a resolved file that vanished with 404', async () => {
    const { resolve } = resolverFor({ '43': path.join(tmpDir, 'missing [43].mp3') });
    const response = await handleMediaRequest(new Request(bookUrl('43')), resolve);

    expect(response.status).toBe(404);
  });
});

describe('registerMediaScheme', () => {
  test('registers the scheme as a privileged streaming scheme', () => {
    const registered: unknown[] = [];
    registerMediaScheme({
      registerSchemesAsPrivileged: (schemes: unknown[]) => registered.push(...schemes),
    });

    expect(registered).toEqual([
      {
        scheme: MEDIA_SCHEME,
        privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
      },
    ]);
  });
});
