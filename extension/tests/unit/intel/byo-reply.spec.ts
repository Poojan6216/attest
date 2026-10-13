/**
 * The person's own key's provider reading a reply (Sprint 5 close, tech review TECH-6; src/intel/providers/byo.ts): a
 * reply that is not JSON is an `IntelError` `bad_reply`, its message the code alone, never the reply; a vendor's
 * request names Anthropic's API version from the vendor table (tech review TECH-9). Every value is invented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHECK_INPUTS } from '../../../entrypoints/model-check/inputs';
import { BYO_VENDORS } from '../../../src/config-network';
import { byoProvider, IntelError } from '../../../src/intel/providers/byo';

const KEY = 'sk-ant-invented-reply-0123456789abcdef';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a reply the provider cannot read', () => {
  it('is a bad_reply, naming nothing of what came back', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>a proxy page, not JSON</html>')));
    const input = CHECK_INPUTS[0];
    if (input === undefined) throw new Error('no check input');
    const answer = byoProvider('anthropic', KEY).score(input, new AbortController().signal);
    await expect(answer).rejects.toBeInstanceOf(IntelError);
    await expect(answer).rejects.toMatchObject({ code: 'bad_reply', message: 'intel: bad_reply' });
  });

  it('names Anthropic’s API version from the vendor table', async () => {
    const inits: RequestInit[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      inits.push(init);
      return Promise.resolve(new Response('{"content":[{"type":"text","text":"{\\"scores\\":[]}"}]}'));
    });
    const input = CHECK_INPUTS[0];
    if (input === undefined) throw new Error('no check input');
    await byoProvider('anthropic', KEY).score(input, new AbortController().signal);
    expect(inits[0]?.headers).toMatchObject({ 'anthropic-version': BYO_VENDORS.anthropic.apiVersion });
  });
});
