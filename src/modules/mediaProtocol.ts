import * as fs from 'fs';
import { Readable } from 'stream';
import type { Protocol } from 'electron';

// Downloaded books are played through `bookwave-media://book/<bookId>`.
// Chromium refuses file:// URLs from an http:// page (the dev renderer runs on
// http://localhost:3000), so the main process serves the file itself, with
// Range support so the audio element can seek and restore a saved position.
// Only type imports from electron here, so the module runs under `bun test`.
export const MEDIA_SCHEME = 'bookwave-media';

const BOOK_HOST = 'book';
const BOOK_PATH = /^\/(\d+)$/;

export type FileResolver = (bookId: string) => string | null;

// Must run before the app is ready: privileged schemes cannot be added later.
export function registerMediaScheme(protocol: Pick<Protocol, 'registerSchemesAsPrivileged'>): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
    },
  ]);
}

// Parses a single `bytes=` range. Returns null when there is no usable range
// (missing, malformed or multi-range), so the caller serves the whole file.
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === '' && endText === '') return null;
  if (size === 0) return 'unsatisfiable';

  if (startText === '') {
    // Suffix range: the last n bytes.
    const length = Number(endText);
    if (length === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(startText);
  const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function bookIdFrom(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== BOOK_HOST) return null;
  return BOOK_PATH.exec(parsed.pathname)?.[1] ?? null;
}

function fileBody(filePath: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream;
}

export async function handleMediaRequest(
  request: Request,
  resolveFile: FileResolver,
): Promise<Response> {
  const bookId = bookIdFrom(request.url);
  if (!bookId) return notFound();

  const filePath = resolveFile(bookId);
  if (!filePath) return notFound();

  let size: number;
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) return notFound();
    size = stats.size;
  } catch {
    return notFound();
  }

  const headers = new Headers({ 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/mpeg' });
  const range = parseRange(request.headers.get('Range'), size);

  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  if (range === null) {
    headers.set('Content-Length', String(size));
    const body = size > 0 ? fileBody(filePath, 0, size - 1) : null;
    return new Response(body, { status: 200, headers });
  }

  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('Content-Length', String(range.end - range.start + 1));
  return new Response(fileBody(filePath, range.start, range.end), { status: 206, headers });
}
