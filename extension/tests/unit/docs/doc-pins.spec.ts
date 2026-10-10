/**
 * What the docs state about the code, pinned to the code (sprint_4 close: tech review TECH-3, security review SEC-10), as
 * changelog.spec.ts pins the golden count: PRIVACY.md's permissions are the manifest's; docs/privacy-architecture.md's
 * schema version and its export example are the last migration's and `LedgerExport`'s, and its list of
 * `chrome.storage.session` keys is `SESSION_KEYS`, and of `chrome.storage.local` keys `STORAGE_KEYS` (Sprint 5 close,
 * tech review TECH-4: the person's key and its vendor among them); docs/adapters.md's bound on `ledger.changed` is `LedgerTable`'s
 * length. Each reader also runs on a changed copy of its doc, to prove it can fail.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { LedgerTable, PAGE_COMMAND_RESULTS } from '../../../src/bus/messages';
import { SESSION_KEYS, SETTABLE_FLAGS, STORAGE_KEYS } from '../../../src/config';
import { LedgerExport } from '../../../src/ledger/export';
import { MIGRATIONS } from '../../../src/ledger/migrations';
import config from '../../../wxt.config';

// As in tests/unit/manifest-hosts.spec.ts: `defineConfig` returns its argument, so the stub never loads WXT.
vi.mock('wxt', () => ({ defineConfig: (block: unknown) => block }));

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const read = (file: string): string => readFileSync(path.join(REPO_ROOT, file), 'utf8');
const PRIVACY = read('PRIVACY.md');
const ARCHITECTURE = read('docs/privacy-architecture.md');
const ADAPTERS = read('docs/adapters.md');

const LATEST_SCHEMA = Math.max(...MIGRATIONS.map(({ version }) => version));

/** The manifest's permissions: wxt.config.ts's, and `sidePanel`, which WXT adds for the side panel entrypoint. */
function manifestPermissions(): { required: string[]; optional: string[] } {
  const block: unknown = config.manifest;
  if (typeof block !== 'object' || block === null) throw new Error('wxt.config.ts manifest is not an object');
  const list = (key: string): string[] => {
    const value: unknown = Reflect.get(block, key);
    return Array.isArray(value) ? value.map(String) : [];
  };
  return {
    required: [...list('permissions'), 'sidePanel'].sort(),
    optional: list('optional_permissions').sort(),
  };
}

/** The words PRIVACY.md names a permission by, where they are not its name. */
const PERMISSION_NAMES: Readonly<Record<string, string>> = { 'side panel': 'sidePanel' };

/** The permissions PRIVACY.md lists under "Permissions": those it always asks for, and those it asks for when needed. */
function privacyPermissions(doc: string): { required: string[]; optional: string[] } {
  const section = doc.split(/^## Permissions$/mu)[1]?.split(/^## /mu)[0] ?? '';
  const [always = '', onlyIf = ''] = section.split(/^Only if you turn on/mu);
  const bullets = (text: string): string[] =>
    [...text.matchAll(/^- ([^,\n]+),/gmu)].map(([, word = '']) => PERMISSION_NAMES[word] ?? word).sort();
  return { required: bullets(always), optional: bullets(onlyIf) };
}

/** The schema version privacy-architecture names for the ledger. */
const statedSchema = (doc: string): number =>
  Number(/schema version (\d+) in \[`migrations\.ts`\]/u.exec(doc)?.[1] ?? Number.NaN);

/** The export example of privacy-architecture's "The export", parsed. */
function exportExample(doc: string): Record<string, unknown> {
  const section = doc.split(/^## 8\. The export$/mu)[1] ?? '';
  const parsed: unknown = JSON.parse(/```json\n([\s\S]*?)\n```/u.exec(section)?.[1] ?? 'null');
  if (typeof parsed !== 'object' || parsed === null) throw new Error('no export example');
  return { ...parsed };
}

/** The `attest.*` keys privacy-architecture says `chrome.storage.session` holds. */
function sessionKeys(doc: string): string[] {
  const paragraph = doc.slice(doc.indexOf('`chrome.storage.session`')).split('\n\n')[0] ?? '';
  return [...new Set([...paragraph.matchAll(/`(attest\.[A-Za-z]+)`/gu)].map(([, key = '']) => key))].sort();
}

/** The `chrome.storage.local` keys the doc names: from its first mention of the area to its first of the session's. */
function localKeys(doc: string): string[] {
  const from = doc.indexOf('`chrome.storage.local`');
  const paragraph = doc.slice(from, doc.indexOf('`chrome.storage.session`', from));
  return [...new Set([...paragraph.matchAll(/`(attest\.[A-Za-z]+)`/gu)].map(([, key = '']) => key))].sort();
}

/** The flags adapters.md's `flag.set` row says a page may set. */
const settableFlags = (doc: string): string[] =>
  [...(/one of `SETTABLE_FLAGS` \(([^;)]*);/u.exec(doc)?.[1] ?? '').matchAll(/`([A-Z_]+)`/gu)]
    .map(([, flag = '']) => flag)
    .sort();

/** The types adapters.md says are dropped as `untrusted_context` from a content script. */
const pageOnlyTypes = (doc: string): string[] =>
  [
    ...(/`untrusted_context` \(([^)]*) from a content script\)/u.exec(doc)?.[1] ?? '').matchAll(
      /`([a-z.]+)`/gu,
    ),
  ]
    .map(([, type = '']) => type)
    .sort();

/** How many table names adapters.md says a `ledger.changed` carries at most. */
const changedBound = (doc: string): number =>
  Number(
    /\| `ledger\.changed` \|[^\n]*`tables` \(1 to (\d+) ledger table names\)/u.exec(doc)?.[1] ?? Number.NaN,
  );

describe('the docs state what the code does (TECH-3, SEC-10)', () => {
  it('PRIVACY.md lists exactly the permissions the manifest asks for, and the optional one apart', () => {
    expect(privacyPermissions(PRIVACY)).toEqual(manifestPermissions());
  });

  it('privacy-architecture names the last migration’s schema version, and its export example is an export', () => {
    expect(statedSchema(ARCHITECTURE)).toBe(LATEST_SCHEMA);
    const example = exportExample(ARCHITECTURE);
    expect(Object.keys(example)).toEqual(Object.keys(LedgerExport.shape));
    expect(Object.keys(example.tables ?? {})).toEqual(Object.keys(LedgerExport.shape.tables.shape));
    expect(example.schemaVersion).toBe(LATEST_SCHEMA);
    expect(LedgerExport.safeParse(example).success).toBe(true);
  });

  it('privacy-architecture lists exactly the chrome.storage.session keys, and adapters.md the tables bound', () => {
    expect(sessionKeys(ARCHITECTURE)).toEqual(Object.values(SESSION_KEYS).sort());
    expect(localKeys(ARCHITECTURE)).toEqual(Object.values(STORAGE_KEYS).sort());
    expect(changedBound(ADAPTERS)).toBe(LedgerTable.options.length);
  });

  it('adapters.md lists exactly the settable flags and the types only an extension page may send (TECH-5)', () => {
    expect(settableFlags(ADAPTERS)).toEqual([...SETTABLE_FLAGS].sort());
    expect(pageOnlyTypes(ADAPTERS)).toEqual(['ui.query', ...Object.keys(PAGE_COMMAND_RESULTS)].sort());
    expect(settableFlags(ADAPTERS.replace(', `ATTEST_TELEMETRY`', ''))).not.toEqual(
      [...SETTABLE_FLAGS].sort(),
    );
    expect(pageOnlyTypes(ADAPTERS.replace(', `byo.forget`', ''))).not.toEqual(
      ['ui.query', ...Object.keys(PAGE_COMMAND_RESULTS)].sort(),
    );
  });

  it('each reader fails on a changed copy of its doc', () => {
    expect(localKeys(ARCHITECTURE.replace(', and `attest.byoVendor`, its company', ''))).not.toEqual(
      Object.values(STORAGE_KEYS).sort(),
    );
    expect(privacyPermissions(PRIVACY.replace(/^- notifications,.*\n/mu, ''))).not.toEqual(
      manifestPermissions(),
    );
    expect(statedSchema(ARCHITECTURE.replace('schema version 11 in', 'schema version 10 in'))).not.toBe(
      LATEST_SCHEMA,
    );
    const noDigests = exportExample(ARCHITECTURE.replace(',\n    "digests": []', ''));
    expect(Object.keys(noDigests.tables ?? {})).not.toEqual(Object.keys(LedgerExport.shape.tables.shape));
    expect(sessionKeys(ARCHITECTURE.replace('`attest.openReceipt`', 'the receipt'))).not.toEqual(
      Object.values(SESSION_KEYS).sort(),
    );
    expect(changedBound(ADAPTERS.replace('(1 to 14 ledger', '(1 to 13 ledger'))).not.toBe(
      LedgerTable.options.length,
    );
  });
});
