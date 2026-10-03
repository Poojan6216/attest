/**
 * sanitizeHtml never reaches the network: the inert window refuses every fetch and XHR, and sanitising a page full
 * of external references makes no request (tests/tools/sanitize.ts step 1). Split from sanitize.spec.ts for size.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { beforeAll, describe, expect, it } from 'vitest';

import { createInertWindow } from '../../tools/capture-dom';
import { loadSeeds, SEEDS_PATH } from '../../tools/capture-output';
import { sanitizeHtml, type SeedSecret } from '../../tools/sanitize';

let SEEDS: SeedSecret[] = [];

beforeAll(async () => {
  SEEDS = await loadSeeds(SEEDS_PATH);
});

function page(body: string, head = ''): string {
  return `<!doctype html><html><head><title>t</title>${head}</head><body><div role="main">${body}</div></body></html>`;
}

function run(html: string): string {
  return sanitizeHtml(html, { seed: 'unit', seeds: SEEDS }).html;
}

async function countingServer(): Promise<{ origin: string; hits: () => number; close: () => void }> {
  let hits = 0;
  const server = http.createServer((_request, response) => {
    hits += 1;
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, hits: () => hits, close: () => server.close() };
}

describe('sanitizeHtml never touches the network', () => {
  it('the sanitiser window refuses every fetch (451) without reaching the server', async () => {
    const server = await countingServer();
    const window = createInertWindow();
    try {
      expect((await window.fetch(`${server.origin}/direct`)).status).toBe(451);
      // Sync XHR blocks this event loop, so it targets a closed port: unblocked, it fails fast with status 0.
      const xhr = new window.XMLHttpRequest();
      xhr.open('GET', 'http://127.0.0.1:9/sync', false);
      xhr.send();
      expect(xhr.status).toBe(451);
      expect(server.hits()).toBe(0);
    } finally {
      await window.happyDOM.close();
      server.close();
    }
  });

  it('never touches the network while sanitising', async () => {
    const server = await countingServer();
    const origin = server.origin;
    const head =
      `<link rel="preload" as="fetch" href="${origin}/preload"><link rel="stylesheet" href="${origin}/css">` +
      `<link rel="modulepreload" href="${origin}/mod"><script src="${origin}/js"></script>` +
      `<style>@import url(${origin}/import);</style><meta http-equiv="refresh" content="0;url=${origin}/refresh">`;
    const body = `<img src="${origin}/img"><iframe src="${origin}/frame"></iframe><svg><image href="${origin}/svg"/></svg>`;
    try {
      run(page(body, head));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(server.hits()).toBe(0);
    } finally {
      server.close();
    }
  });
});
