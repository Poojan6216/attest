/**
 * @gate Sprint 1 — the grep test's banned globals are lint's own (FS-1; Hard Rules 1 and 4). The grep test
 * (core-purity.spec.ts) reads every global it bans from the lists eslint.config.js gives src/core's
 * no-restricted-globals and attest/no-network (eslint-rules/core-names.js, through ./core-scan-globals.ts), so a
 * name lint bans in src/core cannot be missing from it. This file proves that against the configuration ESLint
 * really computes for a src/core file, then name by name: every restricted global read as the global, every network
 * name as a member, and the forms the fence-sanity verification found getting past the grep test (an ordinary
 * `navigator.sendBeacon` beacon and `navigator.language`). Controls: a local named like a global (src/core's time
 * windows are `window`), a member, a key or a type with such a name is not a read of the global. Under the poisoned
 * run (`pnpm test:poison`), the last test checks that the runtime guard has poisoned every one of those globals.
 */
import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { CORE_RESTRICTED_GLOBAL_NAMES, NETWORK_PROPERTIES } from '../../../eslint-rules/core-names.js';
import { isPoisonedGlobal, POISONED_GLOBALS, RUN_SPARED_GLOBALS } from './core-poison';
import { bannedUses } from './core-scan';
import { NETWORK_PATTERNS, RESTRICTED_GLOBALS } from './core-scan-globals';

const EXTENSION_ROOT = path.resolve(import.meta.dirname, '../../..');
const GATE = { tags: ['gate'] };

/** The names of what `bannedUses` reports for `code`, without their lines. */
const namesIn = (code: string): string[] => bannedUses(code).map((hit) => hit.replace(/^line \d+: /, ''));

/** The rules eslint.config.js gives a src/core file, as ESLint resolves them. */
async function coreRules(): Promise<Record<string, unknown>> {
  const eslint = new ESLint({ cwd: EXTENSION_ROOT });
  const config: unknown = await eslint.calculateConfigForFile(path.join(EXTENSION_ROOT, 'src/core/probe.ts'));
  return (config as { rules?: Record<string, unknown> }).rules ?? {};
}

/** The global names a resolved no-restricted-globals setting bans. */
function restrictedNames(options: unknown): string[] {
  if (!Array.isArray(options)) throw new Error('src/core has no no-restricted-globals');
  return options.slice(1).map((option: unknown) => {
    const name: unknown = typeof option === 'string' ? option : (option as { name?: unknown }).name;
    if (typeof name !== 'string') throw new Error('a no-restricted-globals entry without a name');
    return name;
  });
}

describe('core purity scan: every global lint bans in src/core (@gate sprint 1, FS-1)', GATE, () => {
  it('the scan bans every name in no-restricted-globals, and attest/no-network is on, as ESLint resolves src/core', async () => {
    const rules = await coreRules();
    expect(rules['attest/no-network']).toEqual([2]);
    const names = restrictedNames(rules['no-restricted-globals']);
    expect([...new Set(names)].sort()).toEqual([...new Set(CORE_RESTRICTED_GLOBAL_NAMES)].sort());
    expect(names.filter((name) => !RESTRICTED_GLOBALS.has(name))).toEqual([]);
    expect(names).toContain('navigator');
    expect(names).toContain('requestIdleCallback');
  });

  it("the scan bans every name attest/no-network bans, as a word anywhere, by the rule's own list", () => {
    expect(NETWORK_PATTERNS.map(([name]) => name).sort()).toEqual([...NETWORK_PROPERTIES].sort());
    expect([...NETWORK_PROPERTIES]).toEqual(
      expect.arrayContaining(['sendBeacon', 'EventSource', 'importScripts']),
    );
  });

  it.each([...RESTRICTED_GLOBALS])('%s read as the global is caught', (name) => {
    expect(bannedUses(`export const v = (): unknown => ${name};`)).toContain(`line 1: ${name}`);
  });

  it.each([...NETWORK_PROPERTIES])('%s read as a member of anything is caught', (name) => {
    const code = `export const v = (o: Record<string, unknown>) => o.${name};`;
    expect(bannedUses(code)).toContain(`line 1: ${name}`);
  });
});

/** The fence-sanity probes (FS-1), as written, and the other forms each name is read in, with every name reported. */
const READS: readonly (readonly [string, readonly string[]])[] = [
  ["navigator.sendBeacon?.('https://telemetry.example/grade', 'graded');", ['navigator', 'sendBeacon']],
  ["export const de = (s: string) => (navigator.language.startsWith('de') ? s : '');", ['navigator']],
  [
    'export const send = (n: { sendBeacon(u: string): boolean }) => n.sendBeacon("https://x.example");',
    ['sendBeacon'],
  ],
  ['const { language } = navigator;\nexport const l = language;', ['navigator']],
  ['export const o = { navigator };', ['navigator']],
  ["export const n = typeof navigator === 'undefined' ? '' : 'x';", ['navigator']],
  ["export const s = new EventSource('https://x.example/events');", ['EventSource']],
  ["export const t = new WebTransport('https://x.example');", ['WebTransport']],
  ['export const p = new RTCPeerConnection();', ['RTCPeerConnection']],
  ["importScripts('https://x.example/a.js');", ['importScripts']],
  ['export const h = location.href;', ['location']],
  ['export const c = (x: boolean) => (x ? location : null);', ['location']],
  ['requestAnimationFrame(() => undefined);', ['requestAnimationFrame']],
  ['requestIdleCallback(() => undefined);', ['requestIdleCallback']],
  ['export const l = window.navigator.language;', ['window']],
  ['export const d = document.cookie;', ['document']],
  ['export class Feed extends EventSource {}', ['EventSource']],
  ['export const q = (): unknown => (0, console);', ['console']],
];

describe('core purity scan: the reads the fence-sanity verification found (FS-1)', GATE, () => {
  it.each(READS)('%s', (code, names) => {
    for (const name of names) expect(namesIn(code), code).toContain(name);
  });

  it('a global named like a local elsewhere in the file is still caught, on its own line', () => {
    const code = [
      'export function a(): number {',
      '  const window = 1;',
      '  return window;',
      '}',
      'export const b = (): unknown => window.navigator;',
    ].join('\n');
    expect(bannedUses(code)).toEqual(['line 5: window']);
  });

  it("control: a local, a parameter or a destructured binding named like a global is not the global (src/core's `window`)", () => {
    const code = [
      'export function f(windows: readonly { endMs: number }[]): unknown {',
      '  for (const window of windows) if (window.endMs > 0) return window;',
      '  return null;',
      '}',
      'export const g = ({ location }: { location: string }) => location;',
      'export const h = (window: { fromMs: number }, document: string) => window.fromMs + document.length;',
      'export function k(): number {\n  try {\n    return 1;\n  } catch (location) {\n    return String(location).length;\n  }\n}',
    ].join('\n');
    expect(bannedUses(code)).toEqual([]);
  });

  it('control: a member, a key or a type named like a global is not a read of the global', () => {
    const code = [
      'export const k = (o: { location: string; document: number }) => o.location + String(o.document);',
      'export const m = { navigator: 1, console: 2, window: 3 };',
      'export type T = { navigator: string; readonly window: number };',
      'export const { location: where } = { location: 1 };',
      'export class C {\n  window = 1;\n  location(): number {\n    return this.window;\n  }\n}',
    ].join('\n');
    expect(bannedUses(code)).toEqual([]);
  });
});

/** Whether this file runs under the poisoned run's guard (vitest.poison.config.ts, core-poison-setup.ts). */
const POISONED_RUN = isPoisonedGlobal('fetch');

describe('the poisoned run poisons every global lint bans in src/core (FS-1)', GATE, () => {
  it('under its guard each is poisoned, chrome and browser (which the test runner stubs) included; else none', () => {
    const expected = (name: string): boolean => POISONED_RUN && !RUN_SPARED_GLOBALS.includes(name);
    expect(POISONED_GLOBALS.filter((name) => isPoisonedGlobal(name) !== expected(name))).toEqual([]);
    expect(POISONED_GLOBALS).toEqual(expect.arrayContaining(['chrome', 'browser', 'navigator', 'location']));
    expect(RUN_SPARED_GLOBALS).toEqual(['globalThis']);
  });
});
