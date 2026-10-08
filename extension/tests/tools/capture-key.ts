/**
 * The secret key a live capture fakes with (security review, SEC-L2): 32 random bytes, as 64 hex digits, in a file
 * outside the repository (`~/.config/attest/capture-key`), made on first use with owner-only permissions and never
 * printed, logged or committed. Every fake is HMAC(key; kind, original) (./capture-fakes.ts), so a committed fixture's
 * fakes say nothing about the founder's values to anyone without the key. A seed given instead must be a secret too:
 * at least MIN_SEED_LENGTH characters, so a public word such as the tool's old default is refused.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CaptureError, hasErrorCode } from './capture-error';

/** Names another key file (the tool's own tests): never one inside the repository. */
export const CAPTURE_KEY_ENV = 'ATTEST_CAPTURE_KEY_FILE';
/** The fewest characters a seed given to a capture may have: a seed is a secret, never a word. */
export const MIN_SEED_LENGTH = 32;
const KEY_TEXT = /^[0-9a-f]{64}$/u;

/** Where the capture key lives: `$ATTEST_CAPTURE_KEY_FILE`, else the user's own config folder. */
export function captureKeyPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[CAPTURE_KEY_ENV] ?? path.join(os.homedir(), '.config', 'attest', 'capture-key');
}

/** Reads the capture key from `file`, making it on first use. Throws CaptureError('bad_key') for a damaged file. */
export async function captureKey(file: string = captureKeyPath()): Promise<string> {
  try {
    const text = (await readFile(file, 'utf8')).trim();
    if (!KEY_TEXT.test(text)) {
      throw new CaptureError('bad_key', `The capture key file holds no 64-digit hex key: ${file}`);
    }
    return text;
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const key = randomBytes(32).toString('hex');
  try {
    await writeFile(file, `${key}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    // Another capture made it first: read that one, so both fake alike.
    if (hasErrorCode(error, 'EEXIST')) return captureKey(file);
    throw error;
  }
  return key;
}
