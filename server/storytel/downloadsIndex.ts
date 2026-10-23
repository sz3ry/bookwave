import fs from 'node:fs';
import path from 'node:path';

/**
 * Remembers the bookshelf entry of every downloaded book, so the library can
 * be listed offline without asking Storytel. Stored as a JSON object mapping
 * bookId -> bookshelf entry (one item of `/api/bookshelf`'s `books`).
 *
 * The file is a cache: a missing or corrupt file reads as empty and is
 * rewritten on the next change. Writes go through a temporary file that is
 * renamed into place, so a crash never leaves a half-written index.
 */
export interface DownloadsIndex<T = unknown> {
  upsert(bookId: string, entry: T): void;
  remove(bookId: string): void;
  list(): { bookId: string; entry: T }[];
}

export function createDownloadsIndex<T = unknown>(filePath: string): DownloadsIndex<T> {
  const read = (): Record<string, T> => {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, T>;
      }
    } catch {
      // Missing or unreadable index: start over with an empty one.
    }
    return {};
  };

  const write = (entries: Record<string, T>) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(entries));
    fs.renameSync(tmpPath, filePath);
  };

  return {
    upsert(bookId, entry) {
      const entries = read();
      entries[bookId] = entry;
      write(entries);
    },
    remove(bookId) {
      const entries = read();
      if (!(bookId in entries)) return;
      delete entries[bookId];
      write(entries);
    },
    list() {
      return Object.entries(read()).map(([bookId, entry]) => ({ bookId, entry }));
    },
  };
}
