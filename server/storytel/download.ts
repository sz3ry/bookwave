import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { type FetchLike, StorytelHttpError } from './fetch';

/**
 * Streams `url` to `filePath` through a `.part` file that is renamed on success.
 * On any failure, abort included, the `.part` file is removed and the error rethrown.
 * Plain fetch on purpose: signed CDN URLs never carried Storytel headers.
 */
export async function downloadToFile(opts: {
  url: string;
  filePath: string;
  signal: AbortSignal;
  fetch?: FetchLike;
  onProgress?: (received: number, total: number | null) => void;
}): Promise<void> {
  const { url, filePath, signal, onProgress } = opts;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const partPath = `${filePath}.part`;

  try {
    const res = await doFetch(url, { signal });
    if (!res.ok) {
      const data = await res.text().catch(() => '');
      throw new StorytelHttpError(
        `Download failed with status ${res.status}`,
        res.status,
        data,
        res.headers,
      );
    }
    if (!res.body) {
      throw new Error('Download response has no body');
    }

    const length = Number.parseInt(res.headers.get('content-length') ?? '', 10);
    const total = Number.isFinite(length) && length > 0 ? length : null;
    let received = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        onProgress?.(received, total);
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
      tap,
      fs.createWriteStream(partPath),
      { signal },
    );
    await fs.promises.rename(partPath, filePath);
  } catch (error) {
    await fs.promises.rm(partPath, { force: true });
    throw error;
  }
}
