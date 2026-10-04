/**
 * Sprint 2.0 Done-when "`no-act` lint green" over the real files: every file under src/observers is in the
 * attest/no-act scope (Hard Rule 3) with inline disables switched off, and lints clean. A probe written into the
 * skeleton's own path proves the rule bites there. tests/unit/lint/ proves the rule itself.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const OBSERVERS = path.join(root, 'src', 'observers');

const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    {
      ...tseslint.configs.disableTypeChecked,
      languageOptions: { parserOptions: { projectService: false, project: null } },
    },
  ],
});

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

async function severity(file: string, rule: string): Promise<unknown> {
  const config = (await eslint.calculateConfigForFile(file)) as { rules?: Record<string, unknown> };
  const setting = config.rules?.[rule];
  return Array.isArray(setting) ? setting[0] : setting;
}

describe('attest/no-act over src/observers', () => {
  const files = sources(OBSERVERS);

  it('covers the skeleton and its helpers', () => {
    const names = files.map((file) => path.relative(OBSERVERS, file));
    for (const name of [
      'base.ts',
      'batch.ts',
      'activity.ts',
      'plan.ts',
      'serial.ts',
      'account.ts',
      'text.ts',
    ]) {
      expect(names).toContain(name);
    }
  });

  it('is on, at error, for every file', async () => {
    for (const file of files) expect(await severity(file, 'attest/no-act'), file).toBe(2);
  });

  it('every file lints clean (no-act, no-network and the rest)', async () => {
    const results = await eslint.lintFiles(files);
    const problems = results.flatMap((result) =>
      result.messages.map(
        (m) => `${path.relative(root, result.filePath)}:${String(m.line)} ${m.ruleId ?? ''}`,
      ),
    );
    expect(problems).toEqual([]);
  });

  it('bites in the skeleton itself: acting, writing the DOM and inline disables all fail', async () => {
    const probes = [
      "document.querySelector('button')?.click();\n",
      "document.body.setAttribute('data-x', '1');\n",
      "window.dispatchEvent(new Event('keydown'));\n",
      "// eslint-disable-next-line attest/no-act\ndocument.querySelector('input')?.focus();\n",
    ];
    for (const code of probes) {
      const [result] = await eslint.lintText(code, { filePath: path.join(OBSERVERS, 'base.ts') });
      expect(
        result?.messages.map((m) => m.ruleId),
        code,
      ).toContain('attest/no-act');
    }
  });
});
