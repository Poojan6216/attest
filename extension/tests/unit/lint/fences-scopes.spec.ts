/**
 * Probes the per-scope fences added when Sprint 0 closed, through the project's real eslint.config.js:
 * network everywhere (SECURITY-5, TECH-3), vendor-page code cut off from the ledger and storage (TECH-2,
 * SECURITY-V4), web storage and IndexedDB (TECH-V2), no DOM in the worker (TECH-V3), console aliasing and
 * inline disables (SECURITY-V5, TECH-V4), ad-hoc messaging (TECH-4), Node in browser code (TECH-6), literal
 * log calls (QA-2) and core determinism (TECH-V1). Each probe must fail lint; each allowed use must not.
 */
import path from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');

const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    {
      ...tseslint.configs.disableTypeChecked,
      languageOptions: { parserOptions: { projectService: false, project: null } },
    },
  ],
});

async function lint(filePath: string, code: string): Promise<ESLint.LintResult> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  if (!result) throw new Error('no lint result');
  const fatal = result.messages.filter((m) => m.fatal === true);
  expect(
    fatal.map((m) => m.message),
    `${filePath}: probe must parse`,
  ).toEqual([]);
  return result;
}

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  return (await lint(filePath, code)).messages.map((m) => m.ruleId ?? 'null');
}

async function expectFence(cases: readonly (readonly [string, string, string])[]): Promise<void> {
  for (const [file, code, rule] of cases)
    expect(await ruleIds(file, code), `${file}: ${code}`).toContain(rule);
}

async function severity(filePath: string, rule: string): Promise<unknown> {
  const config = (await eslint.calculateConfigForFile(path.join(root, filePath))) as {
    rules?: Record<string, unknown>;
  };
  const setting = config.rules?.[rule];
  return Array.isArray(setting) ? setting[0] : setting;
}

describe('network is fenced in all extension code (Hard Rule 1)', () => {
  it('fetch, sendBeacon, WebSocket and XHR fail outside content scripts too', async () => {
    await expectFence([
      ['src/background/router.ts', "void fetch('https://example.com/');\n", 'attest/no-network'],
      ['src/background/alarms.ts', "export const f = () => fetch('https://x');\n", 'attest/no-network'],
      ['src/ledger/export.ts', "navigator.sendBeacon('https://x', 'y');\n", 'attest/no-network'],
      ['src/ledger/repo.ts', "navigator.sendBeacon('https://x', 'y');\n", 'attest/no-network'],
      ['entrypoints/options/main.tsx', "export const s = new WebSocket('wss://x/');\n", 'attest/no-network'],
      ['entrypoints/background.ts', "void fetch('https://x');\n", 'attest/no-network'],
      ['src/bus/send.ts', 'export const x = new XMLHttpRequest();\n', 'attest/no-network'],
      ['src/ui/probe.ts', "void globalThis.fetch('https://x');\n", 'attest/no-network'],
    ]);
  });

  it('exactly the two files build_spec allows are exempt (Sprint 5.3 and 5.7)', async () => {
    for (const exempt of ['src/telemetry/send.ts', 'src/intel/providers/byo.ts']) {
      expect(await severity(exempt, 'attest/no-network'), exempt).toBe(0);
    }
    for (const fenced of [
      'src/telemetry/aggregate.ts',
      'src/telemetry/send.tsx',
      'src/intel/providers/other.ts',
      'src/intel/byo.ts',
      'src/background/router.ts',
      'entrypoints/options/main.tsx',
      'entrypoints/content/gmail.content.ts',
    ]) {
      expect(await severity(fenced, 'attest/no-network'), fenced).toBe(2);
    }
  });
});

describe('code on a vendor page reaches the ledger only through the bus (TECH-2, SECURITY-V4)', () => {
  it('content scripts, adapters and observers cannot import the ledger, worker, crypto, telemetry, model or UI', async () => {
    const imports = [
      '../../src/ledger/repo',
      '../../src/background/router',
      '../../src/crypto/key',
      '../../src/telemetry/send',
      '../../src/intel/model',
      '../../src/ui/mount',
      'dexie',
      'dexie/dist/dexie',
      'node:fs',
    ];
    for (const spec of imports) {
      const code = `import * as x from '${spec}';\nexport const y = x;\n`;
      expect(await ruleIds('entrypoints/content/gmail.content.ts', code), spec).toContain(
        'no-restricted-imports',
      );
      expect(await ruleIds('src/adapters/muse/extract.ts', code), spec).toContain('no-restricted-imports');
    }
  });

  it('extractors cannot reach the bus or extension APIs; base.ts and content scripts can use the bus', async () => {
    for (const spec of ['../../bus/send', 'wxt/browser', 'wxt/utils/storage']) {
      const code = `import * as x from '${spec}';\nexport const y = x;\n`;
      expect(await ruleIds('src/observers/gmail/extract.ts', code), spec).toContain('no-restricted-imports');
      expect(await ruleIds('src/adapters/claude/health.ts', code), spec).toContain('no-restricted-imports');
    }
    const bus = "import { send } from '../bus/send';\nexport const s = send;\n";
    expect(await ruleIds('src/adapters/base.ts', bus)).toEqual([]);
    const fromContent = "import { send } from '../../src/bus/send';\nexport const s = send;\n";
    expect(await ruleIds('entrypoints/content/gmail.content.ts', fromContent)).toEqual([]);
  });

  it("the vendor origin's storage fails in extractors", async () => {
    await expectFence([
      ['src/observers/gmail/extract.ts', "localStorage.setItem('k', 'v');\n", 'attest/no-act'],
      ['src/adapters/muse/extract.ts', "indexedDB.open('x');\n", 'attest/no-act'],
      ['src/adapters/muse/extract.ts', "sessionStorage.setItem('k', 'v');\n", 'no-restricted-globals'],
    ]);
  });
});

describe('storage is Dexie and chrome.storage only (TECH-V2, build_spec §5)', () => {
  it('web storage fails everywhere; IndexedDB fails outside src/ledger and src/crypto', async () => {
    await expectFence([
      ['src/ledger/repo.ts', "export const v = sessionStorage.getItem('k');\n", 'no-restricted-globals'],
      ['src/background/alarms.ts', "localStorage.setItem('k', 'v');\n", 'no-restricted-globals'],
      ['entrypoints/options/main.tsx', "void caches.open('x');\n", 'no-restricted-globals'],
      ['entrypoints/popup/App.tsx', "void cookieStore.get('x');\n", 'no-restricted-globals'],
      ['src/ui/probe.ts', "export const v = window.localStorage.getItem('k');\n", 'no-restricted-properties'],
      ['src/background/router.ts', "indexedDB.open('x');\n", 'no-restricted-globals'],
      ['entrypoints/options/App.tsx', "indexedDB.open('x');\n", 'no-restricted-globals'],
    ]);
    expect(await ruleIds('src/ledger/db.ts', "export const r = indexedDB.open('x');\n")).toEqual([]);
  });
});

describe('the service worker and the modules it shares have no DOM (TECH-V3)', () => {
  it('window, document, alert and XMLHttpRequest fail there and pass in pages', async () => {
    for (const file of [
      'src/background/alarms.ts',
      'entrypoints/background.ts',
      'src/ledger/repo.ts',
      'src/bus/send.ts',
    ]) {
      expect(await ruleIds(file, 'export const t = document.title;\n'), file).toContain(
        'no-restricted-globals',
      );
      expect(await ruleIds(file, "window.alert('x');\n"), file).toContain('no-restricted-globals');
      expect(await ruleIds(file, "alert('x');\n"), file).toContain('no-restricted-globals');
    }
    expect(await ruleIds('entrypoints/options/App.tsx', 'export const t = document.title;\n')).toEqual([]);
  });
});

describe('logging only through src/log.ts (SECURITY-V5, TECH-V4, Hard Rule 10)', () => {
  it('inline disables have no effect anywhere in extension code', async () => {
    const code = "// eslint-disable-next-line no-console\nconsole.log('secret');\n";
    for (const file of [
      'src/ledger/export.ts',
      'entrypoints/options/main.tsx',
      'entrypoints/popup/main.tsx',
      'src/ui/x.ts',
    ]) {
      const result = await lint(file, code);
      expect(
        result.messages.map((m) => m.ruleId),
        file,
      ).toContain('no-console');
      expect(result.warningCount, file).toBeGreaterThan(0);
    }
    const network = "// eslint-disable-next-line attest/no-network\nvoid fetch('https://x');\n";
    expect(await ruleIds('src/ledger/probe.ts', network)).toContain('attest/no-network');
  });

  it('console reached through an alias fails', async () => {
    await expectFence([
      ['src/bus/send.ts', "globalThis.console.log('x');\n", 'no-restricted-properties'],
      ['src/ledger/repo.ts', "self.console.error('x');\n", 'no-restricted-properties'],
      ['src/background/router.ts', "window.console.log('x');\n", 'no-restricted-properties'],
      ['src/background/router.ts', "const c = console; c.warn('x');\n", 'no-restricted-globals'],
      ['entrypoints/options/main.tsx', "const { log: out } = console; out('x');\n", 'no-restricted-globals'],
    ]);
    expect(await ruleIds('src/log.ts', "console.info('x');\n")).toEqual([]);
  });

  it('log calls name a literal event and literal keys (QA-2)', async () => {
    await expectFence([
      ['src/ledger/repo.ts', "log.info('ledger.row_invalid', { [key]: 1 });\n", 'attest/log-call'],
      ['src/bus/send.ts', "log.info('bus.send_failed', { ...fields });\n", 'attest/log-call'],
      ['entrypoints/options/main.tsx', "log.info('ui.root_missing', fields);\n", 'attest/log-call'],
    ]);
  });
});

describe('runtime messaging only through src/bus (TECH-4)', () => {
  it('sendMessage, onMessage, tabs.sendMessage and connect fail outside src/bus', async () => {
    await expectFence([
      [
        'entrypoints/options/components/Foo.tsx',
        "void browser.runtime.sendMessage({ anything: 'goes' });\n",
        'no-restricted-syntax',
      ],
      [
        'src/background/router.ts',
        'browser.runtime.onMessage.addListener(() => undefined);\n',
        'no-restricted-syntax',
      ],
      ['entrypoints/popup/App.tsx', 'void browser.tabs.sendMessage(1, {});\n', 'no-restricted-syntax'],
      ['entrypoints/popup/App.tsx', 'export const p = browser.runtime.connect();\n', 'no-restricted-syntax'],
      ['src/core/probe.ts', "export const m = chrome.runtime['sendMessage'];\n", 'no-restricted-syntax'],
    ]);
    expect(await ruleIds('src/bus/send.ts', 'browser.runtime.sendMessage({});\n')).toEqual([]);
  });
});

describe('extension code runs in Chrome, never Node (TECH-6)', () => {
  it('Node globals, built-ins and NodeJS types fail', async () => {
    await expectFence([
      ['src/ledger/repo.ts', "export const b = Buffer.from('x');\n", 'no-restricted-globals'],
      ['src/background/router.ts', 'export const e = process.env.X;\n', 'no-restricted-globals'],
      ['entrypoints/options/App.tsx', "export const r = require('x');\n", 'no-restricted-globals'],
      [
        'src/background/alarms.ts',
        "import fs from 'node:fs';\nexport const f = fs;\n",
        'no-restricted-imports',
      ],
      ['src/ledger/db.ts', "import path from 'path';\nexport const p = path;\n", 'no-restricted-imports'],
      ['src/bus/send.ts', 'export let t: NodeJS.Timeout | undefined;\n', 'no-restricted-syntax'],
      ['src/ui/probe.ts', 'export let t: NodeJS.Timeout | undefined;\n', 'no-restricted-syntax'],
    ]);
  });
});

describe('src/core cannot depend on the clock, randomness, time zone or locale (TECH-V1, Hard Rule 4)', () => {
  it('aliasing, destructuring, reflection and host-dependent APIs fail', async () => {
    const probes = [
      ['const { now } = Date; export const t = now();\n', 'attest/core-determinism'],
      ['const r = Math.random; export const x = r();\n', 'attest/core-determinism'],
      ['const { random } = Math; export const x = random();\n', 'attest/core-determinism'],
      ['export const t = Reflect.apply(Date.now, Date, []);\n', 'attest/core-determinism'],
      ['export const h = (s: string) => new Date(s).getHours();\n', 'attest/core-determinism'],
      ['export const z = Intl.DateTimeFormat().resolvedOptions().timeZone;\n', 'no-restricted-globals'],
      ['export const c = (x: string, y: string) => x.localeCompare(y);\n', 'attest/core-determinism'],
      ['export const d = (s: string) => new Date(s).toLocaleDateString();\n', 'attest/core-determinism'],
      ['export const p = (s: string) => Date.parse(s.slice(0, 19));\n', 'attest/core-determinism'],
    ] as const;
    for (const [code, rule] of probes) expect(await ruleIds('src/core/probe.ts', code), code).toContain(rule);
  });
});
