/**
 * Sprint 0.7 Done-when: "a listener registered inside an async callback is caught by a lint rule".
 * Lints probe files under src/bus/ through the project's real eslint.config.js. Type-aware rules are
 * off for these virtual files (as in tests/unit/lint/fences.spec.ts); every file-scoped fence stays on.
 */
import { readFileSync } from 'node:fs';
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
  // A probe that does not parse proves nothing: "the rule did not fire" would pass vacuously.
  expect(result.messages.filter((message) => message.fatal === true)).toEqual([]);
  return result.messages.map((message) => message.ruleId ?? `fatal:${message.message}`);
}

const IMPORT = "import { browser } from 'wxt/browser';\n";

describe('attest/top-level-listeners covers src/bus/**', () => {
  it('an addListener inside an async function under src/bus/ fails', async () => {
    const code = `${IMPORT}export async function start() {\n  await Promise.resolve();\n  browser.runtime.onMessage.addListener(() => false);\n}\n`;
    expect(await ruleIds('src/bus/probe.ts', code)).toContain('attest/top-level-listeners');
  });

  it('an addListener inside a then/setTimeout callback under src/bus/ fails', async () => {
    const inThen = `${IMPORT}export function start(ready: Promise<void>) {\n  void ready.then(() => {\n    browser.runtime.onMessage.addListener(() => false);\n  });\n}\n`;
    const inTimer = `${IMPORT}setTimeout(() => {\n  browser.runtime.onMessage.addListener(() => false);\n}, 0);\n`;
    expect(await ruleIds('src/bus/probe.ts', inThen)).toContain('attest/top-level-listeners');
    expect(await ruleIds('src/bus/probe.ts', inTimer)).toContain('attest/top-level-listeners');
  });

  it('a synchronous registration under src/bus/ passes', async () => {
    const code = `${IMPORT}export function start() {\n  browser.runtime.onMessage.addListener(() => false);\n}\n`;
    expect(await ruleIds('src/bus/probe.ts', code)).not.toContain('attest/top-level-listeners');
  });

  it('the real src/bus/listen.ts passes the rule', async () => {
    const file = 'src/bus/listen.ts';
    const code = readFileSync(path.join(root, file), 'utf8');
    expect(code).toContain('addListener');
    expect(await ruleIds(file, code)).not.toContain('attest/top-level-listeners');
  });
});
