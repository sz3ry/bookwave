import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDownloadsIndex } from './downloadsIndex';

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downloads-index-test-'));
  filePath = path.join(dir, 'downloads-index.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const lalka = { id: 1, book: { name: 'Lalka', consumableId: '1' } };
const potop = { id: 2, book: { name: 'Potop', consumableId: '2' } };

describe('downloadsIndex', () => {
  test('starts empty when the file does not exist', () => {
    expect(createDownloadsIndex(filePath).list()).toEqual([]);
  });

  test('upsert adds and replaces entries, remove deletes them', () => {
    const index = createDownloadsIndex(filePath);
    index.upsert('10', lalka);
    index.upsert('20', potop);
    index.upsert('10', { ...lalka, status: 2 });

    expect(index.list()).toEqual([
      { bookId: '10', entry: { ...lalka, status: 2 } },
      { bookId: '20', entry: potop },
    ]);

    index.remove('10');
    index.remove('missing');
    expect(index.list()).toEqual([{ bookId: '20', entry: potop }]);
  });

  test('persists across instances', () => {
    createDownloadsIndex(filePath).upsert('10', lalka);

    expect(createDownloadsIndex(filePath).list()).toEqual([{ bookId: '10', entry: lalka }]);
  });

  test('treats a corrupt file as empty and recovers on the next write', () => {
    fs.writeFileSync(filePath, '{ not json');
    const index = createDownloadsIndex(filePath);

    expect(index.list()).toEqual([]);
    index.upsert('10', lalka);
    expect(createDownloadsIndex(filePath).list()).toEqual([{ bookId: '10', entry: lalka }]);
  });

  test('treats a file that is not an object map as empty', () => {
    fs.writeFileSync(filePath, '[1, 2, 3]');

    expect(createDownloadsIndex(filePath).list()).toEqual([]);
  });

  test('writes atomically and leaves no temporary file behind', () => {
    const index = createDownloadsIndex(filePath);
    index.upsert('10', lalka);
    index.remove('10');
    index.upsert('20', potop);

    expect(fs.readdirSync(dir)).toEqual(['downloads-index.json']);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ '20': potop });
  });

  test('creates the parent directory when it is missing', () => {
    const nested = path.join(dir, 'nested', 'downloads-index.json');
    createDownloadsIndex(nested).upsert('10', lalka);

    expect(createDownloadsIndex(nested).list()).toEqual([{ bookId: '10', entry: lalka }]);
  });
});
