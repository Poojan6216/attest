/**
 * The layering fences of the Sprint 4 close (tech review TECH-1), probed through the project's real eslint.config.js:
 * pages read the ledger and the service worker is its one writer, so a page may not import the worker's code, a ledger
 * module of writers, or a writer from a ledger module that also reads; the ledger imports neither the worker nor the
 * UI; and the five src/ui text modules the worker bundles have no DOM, as the worker has none. Each probe must fail
 * lint; each allowed import must not.
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
  expect(
    result.messages.filter((m) => m.fatal === true).map((m) => m.message),
    filePath,
  ).toEqual([]);
  return result.messages.map((m) => m.ruleId ?? 'null');
}

describe('a page reads the ledger and never writes it (TECH-1)', () => {
  it.each([
    ['entrypoints/options/probe.ts', "export { syncReaders } from '../../src/background/readers';\n"],
    ['entrypoints/popup/probe.ts', "export { runGradingBatch } from '../../src/background/grading';\n"],
    ['entrypoints/popup/probe.ts', "export { putReceipt } from '../../src/ledger/repo';\n"],
    ['entrypoints/sidepanel/probe.ts', "export { writeUserEvent } from '../../src/ledger/user-events';\n"],
    ['entrypoints/options/probe.ts', "export { saveRetentionDays } from '../../src/ledger/settings';\n"],
    ['entrypoints/digest/probe.ts', "export { saveDigest } from '../../src/ledger/digest';\n"],
    ['entrypoints/options/probe.ts', "export { saveFlag } from '../../src/ledger/consent';\n"],
    ['entrypoints/options/probe.ts', "export { deleteLedger } from '../../src/ledger/shared';\n"],
    ['src/ui/probe.ts', "export { queueAlerts } from '../ledger/alerts';\n"],
    ['src/ui/probe.ts', "export { recordAutoCheck } from '../ledger/auto-check-record';\n"],
  ])('%s may not: %s', async (file, code) => {
    expect(await ruleIds(file, code)).toContain('no-restricted-imports');
  });

  it.each([
    ['entrypoints/options/probe.ts', "export { readRetentionDays } from '../../src/ledger/settings';\n"],
    ['entrypoints/digest/probe.ts', "export { getDigest, digestWeeks } from '../../src/ledger/digest';\n"],
    ['entrypoints/options/probe.ts', "export { readersOff, readFlags } from '../../src/ledger/consent';\n"],
    ['entrypoints/options/probe.ts', "export { getLedger } from '../../src/ledger/shared';\n"],
    ['src/ui/probe.ts', "export type { AlertToShow } from '../ledger/alerts';\n"],
  ])('%s may: %s', async (file, code) => {
    expect(await ruleIds(file, code)).not.toContain('no-restricted-imports');
  });
});

describe('the ledger sits below the worker and the UI (TECH-1)', () => {
  it.each([
    ['src/ledger/probe.ts', "export { alertText } from '../ui/alert-text';\n"],
    ['src/ledger/probe.ts', "export { syncReaders } from '../background/readers';\n"],
  ])('%s may not: %s', async (file, code) => {
    expect(await ruleIds(file, code)).toContain('no-restricted-imports');
  });
});

describe('the src/ui text modules the worker bundles have no DOM (TECH-1)', () => {
  it.each(['src/ui/format.ts', 'src/ui/alert-text.ts', 'src/ui/digest-labels.ts'])(
    '%s may not read document',
    async (file) => {
      expect(await ruleIds(file, 'export const title = document.title;\n')).toContain(
        'no-restricted-globals',
      );
    },
  );
});
