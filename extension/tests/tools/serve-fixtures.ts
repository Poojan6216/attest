/**
 * Static server for `tests/fixtures/pages/**` on localhost (127.0.0.1 only).
 *
 * Used by Playwright E2E tests and by hand: `pnpm exec tsx tests/tools/serve-fixtures.ts [port]`.
 * GET/HEAD only, no directory listings, no path traversal, nothing cached.
 */
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_PAGES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/pages',
);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export interface FixtureServer {
  /** e.g. `http://127.0.0.1:43123` */
  readonly origin: string;
  /** Absolute URL for a path relative to the fixture root, e.g. `url('_harness/blank.html')`. */
  url(relativePath: string): string;
  close(): Promise<void>;
}

export interface FixtureServerOptions {
  readonly port?: number;
  readonly root?: string;
}

/** Resolves a request path inside `root`, or returns null if it escapes it. */
export function resolveInside(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded.split('/').some((segment) => segment === '..')) return null;
  const resolved = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

async function handle(
  root: string,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const pathname = new URL(request.url ?? '/', 'http://fixtures.invalid').pathname;
  const filePath = resolveInside(root, pathname);
  if (filePath === null) {
    response.writeHead(404).end();
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      response.writeHead(404).end();
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end();
  }
}

export async function startFixtureServer(options: FixtureServerOptions = {}): Promise<FixtureServer> {
  const root = options.root ?? FIXTURE_PAGES_ROOT;
  const server = http.createServer((request, response) => {
    handle(root, request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    url: (relativePath) => new URL(relativePath.replace(/^\/+/, ''), `${origin}/`).toString(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const port = Number(process.argv[2] ?? '4173');
  const server = await startFixtureServer({ port });
  console.log(`Serving ${FIXTURE_PAGES_ROOT} at ${server.origin}`);
}
