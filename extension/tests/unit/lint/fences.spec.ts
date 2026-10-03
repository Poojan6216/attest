/**
 * Proves the lint fences through the project's real eslint.config.js (sprint 0.2 Done-when):
 * a deliberate `.click()` in a content script fails, and the escape hatches (inline disables) do not work
 * in the fenced scopes. The src/core fences (a deliberate `import Dexie` in src/core fails, …) are in
 * fences-core.spec.ts.
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

describe('lint fences (real config): acting on a vendor page', () => {
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
});

describe('lint fences (real config): storage, console, listeners, eval', () => {
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

  it('an inline disable does not switch off the listener rule in the background or the bus', async () => {
    const code =
      'export async function init() {\n  // eslint-disable-next-line attest/top-level-listeners\n  chrome.runtime.onMessage.addListener(() => undefined);\n}\n';
    for (const file of ['entrypoints/background.ts', 'src/bus/probe.ts']) {
      expect(await ruleIds(file, code), file).toContain('attest/top-level-listeners');
    }
  });

  it('eval and new Function are forbidden everywhere', async () => {
    expect(await ruleIds('src/ui/probe.ts', "eval('1');\n")).toContain('no-eval');
    expect(await ruleIds('src/ui/probe.ts', "export const f = new Function('return 1');\n")).toContain(
      'no-new-func',
    );
  });
});
