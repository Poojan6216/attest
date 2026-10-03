/**
 * The src/core fences (build_spec §6, Hard Rule 4), proven through the project's real eslint.config.js on virtual
 * files in src/core. Imports are an allowlist (TECH-C2): src/core may import its own modules (`./name`), `zod`
 * and `../../../policy/default.json`, and nothing else, so the modules next door that read the clock or the
 * extension's settings (`../clock`, `../config`, `../setup`) fail too. Globals whose answer depends on the
 * clock, randomness, the host or the garbage collector (WeakRef, FinalizationRegistry) fail. Each probe must
 * fail lint; each control (what src/core legitimately does today) must not.
 * tests/unit/core/core-purity.spec.ts checks the real files for the same things without lint.
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

const PROBE = 'src/core/probe.ts';

async function messages(code: string, filePath = PROBE): Promise<ESLint.LintResult['messages']> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  if (!result) throw new Error('no lint result');
  return result.messages;
}

async function ruleIds(code: string, filePath = PROBE): Promise<string[]> {
  return (await messages(code, filePath)).map((m) => m.ruleId ?? `fatal:${m.message}`);
}

const importOf = (specifier: string) => `import * as x from '${specifier}';\nexport const y = x;\n`;

describe('src/core imports: an allowlist, not a denylist (TECH-C2)', () => {
  it.each([
    ['../clock', 'reads the wall clock (nowIso)'],
    ['../config', "the extension's constants"],
    ['../setup', 'extension setup'],
    ['../log-vocabulary', 'logging'],
    ['../../../policy/other.json', 'a second data file'],
    ['../../policy/default.json', 'the policy by a path that is not the shipped one'],
    ['./sub/module', 'a subfolder'],
    ['./Schema', 'a sibling spelled with other letter case'],
    ['./schema.ts', 'a sibling with an extension'],
    ['zod/v4', 'a zod subpath'],
    ['ulid', 'any other package'],
  ])('importing %s (%s) fails with the allowlist message', async (specifier) => {
    const found = await messages(importOf(specifier));
    expect(found.map((m) => m.ruleId)).toContain('no-restricted-imports');
    expect(found.map((m) => m.message).join('\n')).toContain('src/core imports only its own modules');
  });

  it('re-exports, type-only imports and import-require are checked too', async () => {
    for (const code of [
      "export * from '../clock';\n",
      "export { nowIso } from '../clock';\n",
      "import type { Clock } from '../clock';\nexport type C = Clock;\n",
      "import c = require('../clock');\nexport const t = c;\n",
    ]) {
      expect(await ruleIds(code), code).toContain('no-restricted-imports');
    }
  });

  it('a dynamic import fails', async () => {
    expect(await ruleIds("export const m = import('./schema');\n")).toContain('no-restricted-syntax');
  });

  it('control: what src/core imports today passes (sibling modules, zod, the shipped policy)', async () => {
    const code = [
      "import { z } from 'zod';",
      "import type { Claim } from './schema';",
      "import { MS_PER_MINUTE } from './units';",
      "import defaultPolicyJson from '../../../policy/default.json';",
      "export { canonicalJson } from './hash';",
      "export * from './candidates-time';",
      'export const all = [z, MS_PER_MINUTE, defaultPolicyJson];',
      'export type C = Claim;',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toEqual([]);
  });

  it('the allowlist binds src/core only: src/ui may still import ../clock', async () => {
    expect(await ruleIds(importOf('../clock'), 'src/ui/probe.ts')).toEqual([]);
  });
});

describe('src/core imports: the named bans keep their own messages', () => {
  it('import Dexie in src/core fails', async () => {
    expect(await ruleIds("import Dexie from 'dexie';\nexport const d = Dexie;\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('src/core cannot import impure layers', async () => {
    for (const spec of [
      '../ledger/db',
      '../bus/send',
      '../adapters/base',
      '../observers/base',
      '../log',
      'wxt/browser',
      'node:fs',
    ]) {
      expect(await ruleIds(importOf(spec)), spec).toContain('no-restricted-imports');
    }
    const ledger = await messages(importOf('../ledger/db'));
    expect(ledger.map((m) => m.message).join('\n')).toContain('must not import from impure layers');
  });
});

describe('src/core globals and syntax (Hard Rule 4)', () => {
  it('src/core cannot read the clock, randomness, or extension/DOM globals', async () => {
    const cases: [string, string][] = [
      ['export const t = Date.now();\n', 'no-restricted-syntax'],
      ['export const t = new Date();\n', 'no-restricted-syntax'],
      ['export const r = Math.random();\n', 'no-restricted-syntax'],
      ['export const b = new Uint8Array(4); crypto.getRandomValues(b);\n', 'no-restricted-globals'],
      ['export const id = chrome.runtime.id;\n', 'no-restricted-globals'],
      ['export const t = document.title;\n', 'no-restricted-globals'],
      ["export const p = fetch('x');\n", 'no-restricted-globals'],
    ];
    for (const [code, rule] of cases) expect(await ruleIds(code), code).toContain(rule);
  });

  it('WeakRef and FinalizationRegistry fail: their results depend on the garbage collector (TECH-C2)', async () => {
    const cases: [string, string][] = [
      ['export const t = new WeakRef({}).deref();\n', 'no-restricted-globals'],
      ['export const r = new FinalizationRegistry(() => undefined);\n', 'no-restricted-globals'],
      ['export const W = globalThis.WeakRef;\n', 'no-restricted-properties'],
      ['export const F = self.FinalizationRegistry;\n', 'no-restricted-properties'],
    ];
    for (const [code, rule] of cases) expect(await ruleIds(code), code).toContain(rule);
  });

  it('control: src/core may build dates from inputs and use WeakMap memos', async () => {
    const code =
      'export const t = (iso: string) => new Date(iso).getTime();\nexport const memo = new WeakMap<object, number>();\n';
    expect(await ruleIds(code)).toEqual([]);
  });
});
