/**
 * A key is its vendor's (Sprint 5 close, security review SEC-7; src/bus/page-commands.ts `keyFitsVendor`): Anthropic's
 * keys begin `sk-ant-`, OpenAI's begin `sk-` and never `sk-ant-`. A `byo.save` whose key is the other vendor's is
 * refused by its schema, so it never reaches storage; a pair stored before the check reads as none, so nothing is sent
 * with it, and the log says so without the key. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { readByo } from '../../../src/background/byo';
import { ByoSaveMessage, keyFitsVendor } from '../../../src/bus/page-commands';
import { STORAGE_KEYS } from '../../../src/config';
import { setLogSink, type LogRecord } from '../../../src/log';

const ANTHROPIC_KEY = 'sk-ant-invented-fit-0123456789abcdef';
const OPENAI_KEY = 'sk-proj-invented-fit-0123456789abcdef';

let records: LogRecord[];
let restore: () => void;
beforeEach(() => {
  fakeBrowser.reset();
  records = [];
  restore = setLogSink((record) => records.push(record));
});
afterEach(() => {
  restore();
});

describe('a key is its vendor’s', () => {
  it('fits Anthropic’s keys to Anthropic and OpenAI’s to OpenAI, never across', () => {
    expect(keyFitsVendor('anthropic', ANTHROPIC_KEY)).toBe(true);
    expect(keyFitsVendor('openai', OPENAI_KEY)).toBe(true);
    expect(keyFitsVendor('openai', ANTHROPIC_KEY)).toBe(false);
    expect(keyFitsVendor('anthropic', OPENAI_KEY)).toBe(false);
    expect(keyFitsVendor('anthropic', 'not-a-vendor-key-0123456789')).toBe(false);
    expect(keyFitsVendor('openai', 'not-a-vendor-key-0123456789')).toBe(false);
  });

  it('refuses a save whose key is the other vendor’s', () => {
    expect(ByoSaveMessage.safeParse({ type: 'byo.save', vendor: 'openai', key: OPENAI_KEY }).success).toBe(
      true,
    );
    expect(ByoSaveMessage.safeParse({ type: 'byo.save', vendor: 'anthropic', key: OPENAI_KEY }).success).toBe(
      false,
    );
    expect(ByoSaveMessage.safeParse({ type: 'byo.save', vendor: 'openai', key: ANTHROPIC_KEY }).success).toBe(
      false,
    );
  });

  it('reads a stored pair whose key is the other vendor’s as none, logged without the key', async () => {
    await browser.storage.local.set({
      [STORAGE_KEYS.BYO_KEY]: OPENAI_KEY,
      [STORAGE_KEYS.BYO_VENDOR]: 'anthropic',
    });
    expect(await readByo()).toBeNull();
    expect(records.map((record) => record.event)).toEqual(['byo.stored_invalid']);
    expect(JSON.stringify(records)).not.toContain(OPENAI_KEY);
  });
});
