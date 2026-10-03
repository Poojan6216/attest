/**
 * Which globals the runtime guard (./core-poison.ts) replaces, and the reads of them it lets a dependency make (FS-1;
 * Hard Rules 1 and 4). POISONED_GLOBALS is every name lint's lists name in src/core, read from the same lists
 * eslint.config.js gives no-restricted-globals and attest/no-network (eslint-rules/core-names.js), so the guard
 * cannot drift from lint: a read of any of them from src/core throws, whatever the host has. A global on no list is
 * refused by lint's and the grep test's allowlist (attest/core-globals), not here: the guard can only poison a name.
 */
import path from 'node:path';

import { CORE_RESTRICTED_GLOBAL_NAMES, NETWORK_GLOBALS } from '../../../eslint-rules/core-names.js';
import { each, some, text } from './core-poison-intrinsics';

/**
 * Globals src/core must never even read: every name lint's lists name there (`navigator`, which holds `sendBeacon`
 * and the host's language, `clientInformation`, `location`, `Intl`, `fetch`, `Image`, the timers, …). Absent ones
 * (`location`, `window`, `document`, `Image`, `Temporal` in Node 22) are poisoned all the same.
 */
export const POISONED_GLOBALS: readonly string[] = [
  ...new Set([...CORE_RESTRICTED_GLOBAL_NAMES, ...NETWORK_GLOBALS]),
];

/**
 * The extension API the test runner fakes. WxtVitest's setup file stubs `chrome` and `browser` with vi.stubGlobal,
 * which redefines the property, and it runs after the poisoned run's own setup file has installed the guard; so that
 * run poisons these two again once every setup file has run, before the first test (core-poison-setup.ts). A guard
 * installed by a test file (core-poison.spec.ts) poisons them with the rest.
 */
export const RUNNER_GLOBALS: readonly string[] = ['chrome', 'browser'];

/**
 * The global the poisoned run leaves as it is, for cost. Vitest's `expect` reads `globalThis` several times per
 * assertion: about 254,000 reads in one scope property, whose file took 25.9 s instead of 7.8 s with each read
 * checked, and which went over its 60 s bound in the full run. A banned global read through it still throws: every
 * other global lint bans is poisoned on the global object itself. Lint and the grep test ban the name, and the gate's
 * own guard (core-poison.spec.ts: every golden scenario and the demo, replay, bench and text workloads) poisons it.
 */
export const RUN_SPARED_GLOBALS: readonly string[] = ['globalThis'];

const ZOD_CORE = path.join(path.sep, 'node_modules', 'zod', 'v4', 'core');

/**
 * Reads a dependency makes of a global from its own code, which the guard lets through: zod reads its settings off
 * `globalThis` each time it builds a schema, and reads `navigator` once, to choose between its compiled and its plain
 * parser. Neither read changes what zod returns, and src/core cannot make zod read anything else. A read of the same
 * global from any other file, src/core's own or another dependency's, is still src/core's when src/core made the call.
 */
const DEPENDENCY_READS: readonly (readonly [string, readonly string[]])[] = [
  ['globalThis', [path.join(ZOD_CORE, 'core.js')]],
  ['navigator', [path.join(ZOD_CORE, 'util.js')]],
];

/** The files whose own reads of the global `name` the guard lets through (DEPENDENCY_READS); none for most. */
export function ownReaders(name: string): readonly string[] {
  let found: readonly string[] = [];
  each(DEPENDENCY_READS, ([global, files]) => {
    if (global === name) found = files;
  });
  return found;
}

/** Whether `reader`, the file whose code read a global, is one of `files` (matched by the end of its path). */
export const isOwnReader = (reader: string, files: readonly string[]): boolean =>
  some(files, (file) => text.endsWith(reader, file));
