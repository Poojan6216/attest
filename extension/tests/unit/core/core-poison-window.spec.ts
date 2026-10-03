/**
 * The runtime guard poisons `clientInformation` and the window's loaders and ways out (R4-FENCE-1, R4-FENCE-2; Hard
 * Rules 1 and 4). They are on src/core's shared restricted list now (eslint-rules/core-fences.js), and the guard
 * poisons every name on it (./core-poison-globals.ts), so a read of one from a file counted as src/core throws and is
 * recorded, even inside a `try`, and even where the host has no such global (Node has no `Image`). The verifier's two
 * probes run as JavaScript from such a file; the controls show the same reads from the harness pass.
 */
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { CORE_RESTRICTED_GLOBAL_NAMES } from '../../../eslint-rules/core-names.js';
import { CORE_DIR, installPoison, PoisonError, POISONED_GLOBALS } from './core-poison';

const GATE = { tags: ['gate'] };

/** A file the guard counts as src/core, and one it counts as the harness. */
const CORE_FILE = path.join(CORE_DIR, 'zz-window-probe.ts');
const HARNESS_FILE = path.join(import.meta.dirname, 'zz-window-probe.ts');

/** `code` as a function whose frames are in `file`, as a module in that file would be. */
const runIn = (file: string, code: string): (() => unknown) =>
  vm.runInThisContext(`(function probe() {\n${code}\n})`, { filename: file }) as () => unknown;

/** The window's names the verifier and the brief named (R4-FENCE-1, R4-FENCE-2). */
const WINDOW_NAMES = [
  'clientInformation', 'Image', 'Audio', 'FontFace', 'Worker', 'SharedWorker', 'Notification', 'BroadcastChannel',
  'open', 'opener', 'parent', 'top', 'frames', 'postMessage', 'navigation',
] as const; // prettier-ignore

/** The verifier's probes n19 and n16, as the JavaScript they compile to. */
const N19 =
  "try {\n  const Pixel = Image;\n  new Pixel().src = 'https://t.example/g.gif?graded=1';\n} catch {\n  // no images on this host\n}";
const N16 =
  "const ci2 = typeof clientInformation === 'undefined' ? undefined : clientInformation;\nif (ci2?.language === 'de') void 0;";

/** Runs `use` under a fresh guard; what it threw (a PoisonError's use) and every use the guard recorded. */
function underGuard(use: () => unknown): { thrown: string | null; violations: readonly string[] } {
  const poison = installPoison({ witness: false });
  try {
    use();
    return { thrown: null, violations: [...poison.violations] };
  } catch (error) {
    if (!(error instanceof PoisonError)) throw error;
    return { thrown: error.use, violations: [...poison.violations] };
  } finally {
    poison.restore();
  }
}

describe('the guard poisons the window names lint now bans (@gate sprint 1, R4-FENCE-1/2)', GATE, () => {
  it.each(WINDOW_NAMES)('%s is on the shared list, poisoned, and read from src/core it throws', (name) => {
    expect(CORE_RESTRICTED_GLOBAL_NAMES).toContain(name);
    expect(POISONED_GLOBALS).toContain(name);
    expect(underGuard(runIn(CORE_FILE, `return typeof ${name};`))).toEqual({
      thrown: name,
      violations: [name],
    });
  });

  it("n19, the Image beacon in a try, is recorded although src/core's catch swallows the throw", () => {
    expect(underGuard(runIn(CORE_FILE, N19))).toEqual({ thrown: null, violations: ['Image'] });
  });

  it('n16, the clientInformation read, throws', () => {
    expect(underGuard(runIn(CORE_FILE, N16))).toEqual({
      thrown: 'clientInformation',
      violations: ['clientInformation'],
    });
  });

  it('control: the same reads from the harness pass, and nothing is left poisoned', () => {
    for (const code of [N19, N16, ...WINDOW_NAMES.map((name) => `return typeof ${name};`)])
      expect(underGuard(runIn(HARNESS_FILE, code)), code).toEqual({ thrown: null, violations: [] });
    expect(runIn(CORE_FILE, 'return typeof Image;')()).toBe('undefined');
  });
});
