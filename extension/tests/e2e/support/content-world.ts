/**
 * TEST ONLY: posts a bus message from Attest's own content-script world in a vendor tab, as a buggy or compromised
 * content script on that site could (SEC-V1's threat model). Chrome sets the sender itself (the tab and its page's
 * address), so the service worker's site check (src/background/sender-site.ts) sees the vendor page, exactly as it
 * sees the real observers. The world is found over CDP: the isolated execution context Chrome created for the
 * extension in the page's main frame.
 */
import type { Page } from '@playwright/test';

interface ExecutionContext {
  readonly id: number;
  readonly origin: string;
  readonly name: string;
  readonly auxData?: { readonly type?: string; readonly isDefault?: boolean };
}

/** Attest's content-script world in `page`, over CDP: its session and context id (header). */
async function contentScriptWorld(page: Page, extensionId: string) {
  const cdp = await page.context().newCDPSession(page);
  const contexts: ExecutionContext[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    contexts.push(context);
  });
  await cdp.send('Runtime.enable');
  const world = contexts.find(
    (context) =>
      context.auxData?.type === 'isolated' && context.origin === `chrome-extension://${extensionId}`,
  );
  if (world === undefined) throw new Error('no Attest content-script world in this tab');
  return { cdp, world };
}

/**
 * A function that evaluates `expression` in the content script's world and answers its value, a promise's awaited
 * (Sprint 5 close, SEC-6: what a content script can read).
 */
export async function contentScriptEvaluate(
  page: Page,
  extensionId: string,
): Promise<(expression: string) => Promise<unknown>> {
  const { cdp, world } = await contentScriptWorld(page, extensionId);
  return async (expression) => {
    const answer = await cdp.send('Runtime.evaluate', {
      expression,
      contextId: world.id,
      awaitPromise: true,
      returnByValue: true,
    });
    if (answer.exceptionDetails !== undefined)
      throw new Error('the expression threw in the content-script world');
    return answer.result.value as unknown;
  };
}

/** A function that sends `message` with `chrome.runtime.sendMessage` from the content script's world and answers. */
export async function contentScriptPost(
  page: Page,
  extensionId: string,
): Promise<(message: unknown) => Promise<unknown>> {
  const { cdp, world } = await contentScriptWorld(page, extensionId);
  return async (message) => {
    const answer = await cdp.send('Runtime.evaluate', {
      expression: `chrome.runtime.sendMessage(${JSON.stringify(message)})`,
      contextId: world.id,
      awaitPromise: true,
      returnByValue: true,
    });
    if (answer.exceptionDetails !== undefined)
      throw new Error('the content-script world refused the message');
    return answer.result.value as unknown;
  };
}
