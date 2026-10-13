/**
 * The person's own model key as a provider (src/intel/providers/byo.ts; sprint_5 5.3 done-when), with `fetch` stubbed:
 * each call is one POST to exactly its vendor's official endpoint, and to no other address; its body is the vendor's
 * request with the constant system prompt and exactly the allowlisted input's data block, nothing more; the key is in
 * the vendor's auth header and nowhere else; no cookie, no referrer. The reply's text becomes the answer; a refused
 * request is an `IntelError` naming its kind; a reply that is not the vendor's shape is a `bad_reply`. The key never
 * reaches a log line. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHECK_INPUTS } from '../../../entrypoints/model-check/inputs';
import { BYO_VENDORS } from '../../../src/config-network';
import { scoresFor } from '../../../src/intel';
import type { IntelInput } from '../../../src/intel/input';
import { dataBlock, SYSTEM_PROMPT } from '../../../src/intel/prompt';
import { byoProvider, IntelError } from '../../../src/intel/providers/byo';
import { type LogRecord, setLogSink } from '../../../src/log';

const KEY = 'sk-ant-invented-test-key-0123456789';
const INPUT: IntelInput =
  CHECK_INPUTS[0] ??
  (() => {
    throw new Error('no check claim');
  })();

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

let sent: Sent[];
let reply: () => Response;
let records: LogRecord[];
let restore: () => void;

beforeEach(() => {
  sent = [];
  reply = () => new Response('{}', { status: 200 });
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Promise.resolve(reply());
  });
  records = [];
  restore = setLogSink((record) => records.push(record));
});
afterEach(() => {
  vi.unstubAllGlobals();
  restore();
});

const signal = new AbortController().signal;
/** The body a call sent, as the text it is (the provider sends a string). */
const textOf = (call: Sent | undefined): string => {
  const body = call?.init.body;
  if (typeof body !== 'string') throw new Error('a body that is not text');
  return body;
};
const bodyOf = (call: Sent | undefined): unknown => JSON.parse(textOf(call));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('a call with the person’s Anthropic key', () => {
  it('posts once, to the Messages endpoint, the system prompt and exactly the input’s data block', async () => {
    reply = () => json({ content: [{ type: 'text', text: '{"scores":[]}' }] });
    expect(await byoProvider('anthropic', KEY).score(INPUT, signal)).toEqual({ scores: [] });
    expect(sent.map(({ url }) => url)).toEqual(['https://api.anthropic.com/v1/messages']);
    const [call] = sent;
    expect(call?.init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    expect(call?.init.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(bodyOf(call)).toEqual({
      model: BYO_VENDORS.anthropic.model,
      max_tokens: 1_024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: dataBlock(INPUT) }],
    });
    expect(textOf(call)).not.toContain(KEY);
  });
});

describe('a call with the person’s OpenAI key', () => {
  it('posts once, to the Chat Completions endpoint, the system prompt and exactly the input’s data block', async () => {
    reply = () => json({ choices: [{ message: { role: 'assistant', content: '{"scores":[]}' } }] });
    expect(await byoProvider('openai', KEY).score(INPUT, signal)).toEqual({ scores: [] });
    expect(sent.map(({ url }) => url)).toEqual(['https://api.openai.com/v1/chat/completions']);
    const [call] = sent;
    expect(call?.init.headers).toEqual({
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
    });
    expect(bodyOf(call)).toEqual({
      model: BYO_VENDORS.openai.model,
      max_tokens: 1_024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: dataBlock(INPUT) },
      ],
    });
  });
});

describe('a refusal or an unreadable reply', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate_limited'],
    [500, 'server'],
    [404, 'refused'],
  ] as const)(
    'is an IntelError for status %i (%s), and gives no score, its key in no log',
    async (status, code) => {
      reply = () => new Response(`{"error":{"message":"invalid key ${KEY}"}}`, { status });
      await expect(byoProvider('anthropic', KEY).score(INPUT, signal)).rejects.toEqual(new IntelError(code));
      expect(await scoresFor(byoProvider('anthropic', KEY), INPUT)).toBeUndefined();
      expect(records.map(({ event, fields }) => [event, fields.provider])).toEqual([['intel.failed', 'byo']]);
      expect(JSON.stringify(records)).not.toContain(KEY);
    },
  );

  it('is a bad_reply when the reply is not the vendor’s shape, and no answer when its text is not JSON', async () => {
    reply = () => json({ completion: 'yes' });
    await expect(byoProvider('anthropic', KEY).score(INPUT, signal)).rejects.toEqual(
      new IntelError('bad_reply'),
    );
    reply = () => json({ content: [{ type: 'text', text: 'The first one matches.' }] });
    expect(await byoProvider('anthropic', KEY).score(INPUT, signal)).toBe('The first one matches.');
  });
});

describe('the vendors Attest may call', () => {
  it('are two, each with its official host, and each endpoint on that host', () => {
    expect(Object.keys(BYO_VENDORS)).toEqual(['anthropic', 'openai']);
    for (const { host, endpoint } of Object.values(BYO_VENDORS)) expect(new URL(endpoint).host).toBe(host);
  });
});
