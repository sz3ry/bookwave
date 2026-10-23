import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Shared entrypoint for route tests. fastify-common reads env and creates its
// downloads directory at import time, and every test file in one `bun test`
// run gets the same module instance. Each file setting its own env and
// deleting its own directory made the result depend on file order, so the
// env is set here once, the directory lives until the process exits, and the
// variables are restored so other test files do not see them.
export const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookwave-routes-'));

const testEnv = {
  IS_ELECTRON: 'true',
  DOWNLOAD_PATH: testDir,
  USER_DATA_PATH: testDir,
  NODE_ENV: 'production', // silences the Fastify request logger
};
const savedEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));
Object.assign(process.env, testEnv);

const server = await import('./fastify-common');

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

process.on('exit', () => fs.rmSync(testDir, { recursive: true, force: true }));

export default server.default;
export const {
  auth,
  audiotekaAuth,
  configureSessionForTests,
  configureAudiotekaForTests,
  resolveDownloadedFile,
} = server;
