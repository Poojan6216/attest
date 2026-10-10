/**
 * The person's own model key as the advisory model's provider (sprint_5 5.3; agents/intel_engineer.md rules 6 and 7).
 * Off unless the person turns it on with a key they saved. Each call is one POST to the vendor's official endpoint
 * (src/config.ts BYO_VENDORS: Anthropic's Messages API or OpenAI's Chat Completions API), and nowhere else: this file
 * holds the extension's one network call besides the opt-in telemetry's (eslint-rules/fences.js
 * NETWORK_EXEMPT_FILES; tests/e2e/built-bundle.spec.ts). The body is the constant system prompt and the input's data
 * block (../prompt.ts), the same allowlisted facts the on-device model sees, and nothing else; the key goes only in
 * the vendor's auth header. No cookie, no referrer, no cache. An answer that is not the vendor's text reply is no
 * answer; a refused request throws an `IntelError` naming its kind, never its body, and the call contract logs it.
 * What the vendor keeps, it keeps under its own terms: the options page says so (Hard Rule 1).
 */
import { BYO_VENDORS, type ByoVendor } from '../../config';
import type { IntelProvider } from '..';
import { dataBlock, SYSTEM_PROMPT } from '../prompt';

/** How long a reply may be: one short JSON answer per candidate. */
const MAX_REPLY_TOKENS = 1_024;

export type IntelErrorCode = 'unauthorized' | 'rate_limited' | 'server' | 'refused' | 'bad_reply';

/** A vendor's refusal or an unreadable reply. Its message is its code alone, so it never prints content. */
export class IntelError extends Error {
  override readonly name = 'IntelError';
  readonly code: IntelErrorCode;

  constructor(code: IntelErrorCode) {
    super(`intel: ${code}`);
    this.code = code;
  }
}

/** The kind of a refused request, from its status alone. */
function refusalOf(status: number): IntelErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'server' : 'refused';
}

/** The request each vendor's endpoint takes: the system prompt and the data block, the key in its auth header. */
function requestOf(
  vendor: ByoVendor,
  key: string,
  data: string,
): { headers: Record<string, string>; body: string } {
  const { model } = BYO_VENDORS[vendor];
  if (vendor === 'anthropic') {
    return {
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_REPLY_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: data }],
      }),
    };
  }
  return {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: MAX_REPLY_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: data },
      ],
    }),
  };
}

/** The reply's text: Anthropic's first text block, or OpenAI's first choice's message; else a `bad_reply`. */
function textOf(vendor: ByoVendor, reply: unknown): string {
  const read = (value: unknown, ...path: (string | number)[]): unknown =>
    path.reduce<unknown>(
      (at, key) => (typeof at === 'object' && at !== null ? Reflect.get(at, key) : undefined),
      value,
    );
  const text =
    vendor === 'anthropic'
      ? read(reply, 'content', 0, 'text')
      : read(reply, 'choices', 0, 'message', 'content');
  if (typeof text !== 'string') throw new IntelError('bad_reply');
  return text;
}

/** The answer as JSON, or the text itself when it is not JSON (the caller reads that as no answer). */
function parsedOrText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** The extension's one call to a model vendor (header): a POST to that vendor's endpoint, written out. */
function post(vendor: ByoVendor, init: RequestInit): Promise<Response> {
  return fetch(BYO_VENDORS[vendor].endpoint, init);
}

/** The person's key with `vendor` as a provider (header). */
export function byoProvider(vendor: ByoVendor, key: string): IntelProvider {
  return {
    id: 'byo',
    async score(input, signal) {
      const { headers, body } = requestOf(vendor, key, dataBlock(input));
      const response = await post(vendor, {
        method: 'POST',
        headers,
        body,
        signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      if (!response.ok) throw new IntelError(refusalOf(response.status));
      return parsedOrText(textOf(vendor, (await response.json()) as unknown));
    },
  };
}
