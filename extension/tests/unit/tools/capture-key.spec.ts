/**
 * The capture key (tests/tools/capture-key.ts; security review SEC-L2): a live capture fakes with a secret kept
 * outside the repository, made on first use, readable by its owner only, and the same on every later read, so two
 * captures fake one value alike. A damaged file is refused rather than replaced.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CaptureError } from '../../tools/capture-error';
import { CAPTURE_KEY_ENV, captureKey, captureKeyPath } from '../../tools/capture-key';
import { Faker } from '../../tools/capture-fakes';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'attest-capture-key-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('captureKey', () => {
  it('makes a 64-digit hex key on first use, owner-only, in a folder it makes, and reads the same one later', async () => {
    const file = path.join(dir, 'nested', 'capture-key');
    const key = await captureKey(file);
    expect(key).toMatch(/^[0-9a-f]{64}$/u);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
    expect(await captureKey(file)).toBe(key);
    expect((await readFile(file, 'utf8')).trim()).toBe(key);
  });

  it('refuses a damaged file rather than replacing it', async () => {
    const file = path.join(dir, 'capture-key');
    await writeFile(file, 'attest\n');
    await expect(captureKey(file)).rejects.toThrow(CaptureError);
    await expect(captureKey(file)).rejects.toMatchObject({ code: 'bad_key' });
    expect(await readFile(file, 'utf8')).toBe('attest\n');
  });

  it('lives in the user config folder, or where the environment names', () => {
    expect(captureKeyPath({})).toBe(path.join(os.homedir(), '.config', 'attest', 'capture-key'));
    expect(captureKeyPath({ [CAPTURE_KEY_ENV]: '/tmp/k' })).toBe('/tmp/k');
  });
});

describe('a keyed fake says nothing without its key (SEC-L2)', () => {
  it('the same original fakes alike under one key and differently under another', () => {
    const one = new Faker('a'.repeat(64));
    const again = new Faker('a'.repeat(64));
    const other = new Faker('b'.repeat(64));
    expect(one.card('4242')).toBe(again.card('4242'));
    expect(one.bytes('card', '4242')).not.toEqual(other.bytes('card', '4242'));
  });
});
