import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type FixtureServer, resolveInside, startFixtureServer } from '../../tools/serve-fixtures';

const ROOT = '/srv/fixtures';

describe('resolveInside', () => {
  it.each([
    ['/gmail/2026-10-01/sent.html', '/srv/fixtures/gmail/2026-10-01/sent.html'],
    ['/_harness/blank.html', '/srv/fixtures/_harness/blank.html'],
    ['/gmail//sent.html', '/srv/fixtures/gmail/sent.html'],
  ])('resolves %s inside the root', (requestPath, expected) => {
    expect(resolveInside(ROOT, requestPath)).toBe(path.resolve(expected));
  });

  it.each([
    '/../secret.txt',
    '/..%2Fsecret.txt',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/a/../b.html',
    '/a\\..\\b.html',
    '/',
    '',
    '/bad%00.html',
    '/%E0%A4%A',
  ])('rejects %s', (requestPath) => {
    expect(resolveInside(ROOT, requestPath)).toBeNull();
  });
});

describe('startFixtureServer', () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it('serves the blank harness page from 127.0.0.1', async () => {
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(server.url('_harness/blank.html'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('Attest harness: blank page');
  });

  it('returns 404 for missing files and traversal, 405 for writes', async () => {
    expect((await fetch(server.url('nope.html'))).status).toBe(404);
    expect((await fetch(`${server.origin}/..%2F..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(server.url('_harness/blank.html'), { method: 'POST' })).status).toBe(405);
  });
});
