/**
 * Proves the lint fences through the project's real eslint.config.js (sprint 0.2 Done-when):
 * a deliberate `.click()` in a content script fails, a deliberate `import Dexie` in src/core fails,
 * and the escape hatches (inline disables) do not work in the fenced scopes.
 * Type-aware rules are switched off for these virtual files; every file-scoped fence stays on.
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

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  if (!result) throw new Error('no lint result');
  return result.messages.map((m) => m.ruleId ?? `fatal:${m.message}`);
}

describe('lint fences (real config)', () => {
  it('a .click() in a content script fails attest/no-act', async () => {
    const ids = await ruleIds(
      'entrypoints/content/probe.content.ts',
      "document.querySelector('button')?.click();\n",
    );
    expect(ids).toContain('attest/no-act');
  });

  it('no-act also covers src/adapters and src/observers', async () => {
    expect(await ruleIds('src/adapters/probe.ts', "fetch('https://example.com');\n")).toContain(
      'attest/no-act',
    );
    expect(await ruleIds('src/observers/probe.ts', "el.value = 'x';\n")).toContain('attest/no-act');
  });

  it('an inline disable comment does not switch off no-act in a content script', async () => {
    const code = "// eslint-disable-next-line attest/no-act\ndocument.querySelector('button')?.click();\n";
    const [result] = await eslint.lintText(code, {
      filePath: path.join(root, 'entrypoints/content/probe.content.ts'),
    });
    expect(result?.messages.some((m) => m.ruleId === 'attest/no-act')).toBe(true);
    expect(result?.warningCount ?? 0).toBeGreaterThan(0); // the ignored directive is itself reported
  });

  it('import Dexie in src/core fails', async () => {
    expect(
      await ruleIds('src/core/probe.ts', "import Dexie from 'dexie';\nexport const d = Dexie;\n"),
    ).toContain('no-restricted-imports');
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
      const ids = await ruleIds('src/core/probe.ts', `import * as x from '${spec}';\nexport const y = x;\n`);
      expect(ids, spec).toContain('no-restricted-imports');
    }
  });

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
    for (const [code, rule] of cases) {
      expect(await ruleIds('src/core/probe.ts', code), code).toContain(rule);
    }
  });

  it('src/core may build dates from inputs', async () => {
    const ids = await ruleIds(
      'src/core/probe.ts',
      'export const t = (iso: string) => new Date(iso).getTime();\n',
    );
    expect(ids).toEqual([]);
  });

  it('Dexie is allowed in src/ledger and forbidden elsewhere', async () => {
    const code = "import Dexie from 'dexie';\nexport const d = Dexie;\n";
    expect(await ruleIds('src/ledger/probe.ts', code)).toEqual([]);
    expect(await ruleIds('src/ui/probe.ts', code)).toContain('no-restricted-imports');
    expect(await ruleIds('entrypoints/background.ts', code)).toContain('no-restricted-imports');
  });

  it('console is only allowed in src/log.ts', async () => {
    expect(await ruleIds('src/bus/probe.ts', "console.log('x');\n")).toContain('no-console');
    expect(await ruleIds('entrypoints/popup/probe.ts', "console.error('x');\n")).toContain('no-console');
    expect(await ruleIds('src/log.ts', "console.info('x');\n")).not.toContain('no-console');
  });

  it('a listener registered inside an async function in the background fails', async () => {
    const code =
      'export async function init() {\n  chrome.runtime.onMessage.addListener(() => undefined);\n}\n';
    expect(await ruleIds('entrypoints/background.ts', code)).toContain('attest/top-level-listeners');
  });

  it('eval and new Function are forbidden everywhere', async () => {
    expect(await ruleIds('src/ui/probe.ts', "eval('1');\n")).toContain('no-eval');
    expect(await ruleIds('src/ui/probe.ts', "export const f = new Function('return 1');\n")).toContain(
      'no-new-func',
    );
  });
});
