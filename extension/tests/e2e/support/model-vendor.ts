/**
 * A stand-in for Anthropic's Messages API (sprint_5 5.4), so the end-to-end test runs the person's own key's real
 * call without reaching Anthropic: a route on exactly the endpoint the provider posts to (src/config.ts BYO_VENDORS),
 * registered after the route guard so it answers first, that records every request (method, headers, body) and
 * answers each POST as the API does, with a text block holding the model's JSON: every candidate it was given scored
 * `score`. A browser's CORS preflight is answered too, as the API answers one. Nothing reaches the network: the
 * browser also runs behind the dead proxy (./network-guard.ts).
 */
import type { BrowserContext, Page } from '@playwright/test';

import { BYO_VENDORS } from '../../../src/config-network';

export interface VendorRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/** The candidate ids of the data block in a Messages request's body (src/intel/prompt.ts `dataBlock`). */
function candidateIds(body: string): string[] {
  const request: unknown = JSON.parse(body);
  const content: unknown = Reflect.get(
    Reflect.get(Reflect.get(request ?? {}, 'messages') ?? [], 0) ?? {},
    'content',
  );
  const data = /<data>\n([\s\S]*)\n<\/data>/u.exec(String(content))?.[1] ?? '{}';
  const candidates: unknown = Reflect.get(JSON.parse(data) as object, 'candidates');
  return Array.isArray(candidates)
    ? candidates.map((candidate) => String(Reflect.get(candidate as object, 'id')))
    : [];
}

/** Answers Anthropic's endpoint (header); resolves the live list of what it was sent. */
export async function stubAnthropic(context: BrowserContext, score = 1): Promise<VendorRequest[]> {
  const requests: VendorRequest[] = [];
  await context.route(BYO_VENDORS.anthropic.endpoint, async (route) => {
    const request = route.request();
    const body = request.postData() ?? '';
    requests.push({ method: request.method(), headers: await request.allHeaders(), body });
    if (request.method() !== 'POST') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const answer = { scores: candidateIds(body).map((candidateId) => ({ candidateId, score })) };
    await route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_invented',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        stop_reason: 'end_turn',
      }),
    });
  });
  return requests;
}

/**
 * The secret-seed test's plant into the model channel (Sprint 5 close, QA GAP 5): `values` in the body of a request to
 * Anthropic's endpoint from an extension page, answered by the stand-in, which keeps it. The body is a Messages request
 * with no data block, so the stand-in answers it as a request naming no candidate.
 */
export async function plantInModel(page: Page, values: readonly string[]): Promise<void> {
  const body = JSON.stringify({ messages: [{ role: 'user', content: values.join(' ') }] });
  await page.evaluate(
    ([endpoint, sent]) =>
      fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: sent }).then(
        () => undefined,
        () => undefined,
      ),
    [BYO_VENDORS.anthropic.endpoint, body] as const,
  );
}
