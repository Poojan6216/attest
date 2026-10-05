/**
 * TECH-10 (Sprint 2 close), through the project's real eslint.config.js: the edges of the vendor-page fences.
 *  - An extractor cannot reach the bus through the skeleton: `../base` (which posts to the bus) and `../plan` (which
 *    only the skeleton runs) are refused in `src/observers/<source>/…` and `src/adapters/<vendor>/…`.
 *  - The helpers extractors import (`src/observers/*.ts` but base.ts) cannot import the bus, an extension API or the
 *    skeleton either, so no import chain from an extractor reaches the bus.
 *  - Code on a vendor page cannot use extension storage (`browser.storage`, `chrome.storage`, however reached, or
 *    WXT's storage helpers): it posts to the service worker through src/bus (Hard Rule 2).
 * Each probe must fail lint; each allowed use must not.
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
  const fatal = result.messages.filter((m) => m.fatal === true).map((m) => m.message);
  expect(fatal, `${filePath}: probe must parse`).toEqual([]);
  return result.messages.map((m) => m.ruleId ?? 'null');
}

const importing = (spec: string): string => `import * as x from '${spec}';\nexport const y = x;\n`;

describe('extractors cannot reach the bus through the skeleton (TECH-10)', () => {
  it('../base and ../plan are refused in every extractor', async () => {
    const cases = [
      ['src/observers/gcal/health.ts', '../base'],
      ['src/observers/gcal/health.ts', '../plan'],
      ['src/observers/gmail/receipts/stripe.ts', '../../base'],
      ['src/observers/gmail/receipts/stripe.ts', '../../plan'],
      ['src/adapters/muse/extract.ts', '../base'],
    ] as const;
    for (const [file, spec] of cases) {
      expect(await ruleIds(file, importing(spec)), `${file} ← ${spec}`).toContain('no-restricted-imports');
    }
  });

  it('the bus-free helpers stay open to extractors (the control)', async () => {
    for (const spec of ['../time-zone', '../text', '../types', '../shown', '../batch']) {
      expect(await ruleIds('src/observers/gcal/health.ts', importing(spec)), spec).toEqual([]);
    }
  });
});

describe('the helpers extractors import are as pure as the extractors (TECH-10)', () => {
  it('a top-level observer helper cannot import the bus, an extension API or the skeleton', async () => {
    for (const spec of ['../bus/send', '../bus/messages', 'wxt/browser', 'wxt/utils/storage', './base']) {
      expect(await ruleIds('src/observers/text.ts', importing(spec)), spec).toContain(
        'no-restricted-imports',
      );
      expect(await ruleIds('src/observers/lifecycle.ts', importing(spec)), spec).toContain(
        'no-restricted-imports',
      );
    }
  });

  it('the skeleton itself still posts to the bus (the control)', async () => {
    expect(await ruleIds('src/observers/base.ts', importing('../bus/send'))).toEqual([]);
    expect(
      await ruleIds(
        'src/observers/coverage.ts',
        "import type { PassInput } from './plan';\nexport type P = PassInput;\n",
      ),
    ).toEqual([]);
  });
});

describe('code on a vendor page never uses extension storage (TECH-10, Hard Rule 2)', () => {
  const probes = [
    "void browser.storage.local.get('k');\n",
    'void chrome.storage.local.set({ k: 1 });\n',
    "void globalThis.chrome.storage.sync.get('k');\n",
    "const { storage } = browser;\nvoid storage.local.get('k');\n",
    "void browser['storage'].local.get('k');\n",
  ];

  it('browser.storage and chrome.storage fail in content scripts, observers and adapters, however reached', async () => {
    for (const file of [
      'entrypoints/content/gmail.content.ts',
      'src/observers/text.ts',
      'src/observers/base.ts',
    ]) {
      for (const code of probes) {
        expect(await ruleIds(file, code), `${file}: ${code}`).toContain('no-restricted-syntax');
      }
    }
    expect(await ruleIds('src/adapters/muse/extract.ts', probes[0] ?? '')).toContain('no-restricted-syntax');
  });

  it("WXT's storage helpers are refused as imports on a vendor page", async () => {
    for (const spec of ['wxt/utils/storage', '@wxt-dev/storage']) {
      expect(await ruleIds('entrypoints/content/gmail.content.ts', importing(spec)), spec).toContain(
        'no-restricted-imports',
      );
    }
  });

  it('the service worker keeps extension storage (the control)', async () => {
    expect(await ruleIds('src/background/install.ts', probes[0] ?? '')).not.toContain('no-restricted-syntax');
  });
});
