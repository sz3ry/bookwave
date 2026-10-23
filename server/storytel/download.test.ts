import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadToFile } from './download';
import type { FetchLike } from './fetch';

const encoder = new TextEncoder();

function streamOf(chunks: string[], stallAfter = false): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
        return;
      }
      if (stallAfter) return new Promise<void>(() => {});
      controller.close();
    },
  });
}

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-test-'));
  filePath = path.join(dir, 'book.mp3');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('downloadToFile', () => {
  it('writes file and removes part', async () => {
    const fetchStub: FetchLike = async () => new Response(streamOf(['aa', 'bb', 'cc']));
    await downloadToFile({
      url: 'https://cdn.example/x',
      filePath,
      signal: new AbortController().signal,
      fetch: fetchStub,
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('aabbcc');
    expect(fs.existsSync(`${filePath}.part`)).toBe(false);
  });

  it('abort removes part file', async () => {
    const controller = new AbortController();
    const fetchStub: FetchLike = async (_url, init) => {
      const body = streamOf(['aa'], true);
      init?.signal?.addEventListener('abort', () => {});
      return new Response(body);
    };
    const promise = downloadToFile({
      url: 'https://cdn.example/x',
      filePath,
      signal: controller.signal,
      fetch: fetchStub,
    });
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await expect(promise).rejects.toBeDefined();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('HTTP 403 removes part file', async () => {
    const fetchStub: FetchLike = async () => new Response('denied', { status: 403 });
    await expect(
      downloadToFile({
        url: 'https://cdn.example/x',
        filePath,
        signal: new AbortController().signal,
        fetch: fetchStub,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('reports progress', async () => {
    const fetchStub: FetchLike = async () =>
      new Response(streamOf(['aa', 'bbbb', 'cc']), { headers: { 'content-length': '8' } });
    const calls: Array<[number, number | null]> = [];
    await downloadToFile({
      url: 'https://cdn.example/x',
      filePath,
      signal: new AbortController().signal,
      fetch: fetchStub,
      onProgress: (received, total) => calls.push([received, total]),
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1]).toEqual([8, 8]);
    for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThan(calls[i - 1][0]);
  });
});
