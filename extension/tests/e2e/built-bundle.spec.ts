/**
 * Audits the build that ships (pnpm e2e rebuilds it first), not the source:
 *  - the manifest says exactly what Decisions.md says (permissions, no host permissions, strict CSP, the
 *    toolbar tooltip from the popup's <title>: TECH-14);
 *  - no shipped script contains a network call, eval, or a Function constructor (SECURITY-6, Hard Rules 1
 *    and 9), apart from the allowlisted sites below.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { EXTENSION_PATH } from './support/extension';

/**
 * The only matches allowed. Each is a whole, exact construct, removed before the scan:
 *  - Zod 4's eval probe, skipped when `jitless` is set (src/setup.ts sets it before any schema is built).
 * Sprint 5.7 adds the one fetch in src/telemetry/send.ts here, with a Decisions.md entry.
 */
const ALLOWED = [
  /if\([\w$]+\.jitless\|\|[^;]{0,120}Cloudflare`\)\)return!1;try\{return Function\(``\),!0\}catch\{return!1\}/g,
];

const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/],
  ['eval(', /\beval\s*\(/],
  ['importScripts', /\bimportScripts\b/],
  ['Function constructor', /\bFunction\s*\(/],
  ['new Image (beacon)', /\bnew\s+Image\s*\(/],
  ['new Audio (beacon)', /\bnew\s+Audio\s*\(/],
];

function scripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return scripts(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('the shipped manifest matches the decisions', () => {
  const manifest = JSON.parse(readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  expect(manifest.action).toEqual({
    default_title: 'Attest: receipts for your AI agents',
    default_popup: 'popup.html',
  });
  expect(manifest.permissions).toEqual(['storage', 'alarms', 'sidePanel']);
  expect(manifest.host_permissions).toEqual([]);
  expect(manifest.content_security_policy).toEqual({
    extension_pages: "script-src 'self'; object-src 'none'",
  });
  expect(manifest).not.toHaveProperty('optional_host_permissions');
});

test('no shipped script reaches the network or evaluates code', () => {
  const files = scripts(EXTENSION_PATH);
  expect(files.length).toBeGreaterThan(3);
  let allowedHits = 0;
  const hits: string[] = [];
  for (const file of files) {
    let source = readFileSync(file, 'utf8');
    for (const allowed of ALLOWED) {
      source = source.replace(allowed, () => {
        allowedHits += 1;
        return '';
      });
    }
    for (const [label, pattern] of FORBIDDEN) {
      if (pattern.test(source)) hits.push(`${path.relative(EXTENSION_PATH, file)}: ${label}`);
    }
  }
  expect(hits).toEqual([]);
  // The allowlist is not stale: the Zod probe is really there (once per chunk that bundles Zod).
  expect(allowedHits).toBeGreaterThanOrEqual(1);
});
