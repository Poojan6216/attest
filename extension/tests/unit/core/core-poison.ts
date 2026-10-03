/**
 * The runtime poison behind tests/unit/core/core-poison.spec.ts (Hard Rule 4; PI-1 to PI-4, PI-6). Lint and the grep
 * test read src/core's text; this watches what it does. While installed, every global through which code could read
 * the clock, randomness, the host's time zone or locale, the network, a timer or the garbage collector is replaced
 * by a twin that, when src/core made the call, records it and throws a PoisonError. Any other caller (the test
 * harness, Vitest, Node) gets the real thing. Recording as well as throwing means a `catch` in src/core cannot hide
 * a use.
 *
 * Who made a call is read from the stack: the innermost frame that is neither this file nor a dependency (a file
 * under node_modules, a Node internal, native or eval'd code) decides. So a dependency src/core calls (zod running
 * one of core's refinements) counts as src/core, and a function the harness hands to src/core (an injected
 * `OffsetAt`) counts as the harness, as it does in the extension. A frame of the test runner itself (Vitest, Vite)
 * is the harness wherever it sits: its module runner loads src/core's imports from inside src/core's own frames.
 *
 * Poisoned:
 *  - `Date.now`, `Date.parse`, `Date()` called as a function, and `new Date` given no argument, several (a spread
 *    is just as many), or one that is not a number, a Date or an ISO timestamp with an explicit offset;
 *  - every Date method that reads or writes local time or renders text by the host's time zone or locale
 *    (`getHours`, `getTimezoneOffset`, `setDate`, `toString`, `toLocaleString`, …), and
 *    `Date.prototype[Symbol.toPrimitive]` for any hint but 'number' (`String(date)`, `${date}`, `date + ''`);
 *    the Date constructor reached from an instance (`.constructor`) is the twin too;
 *  - `Math.random`, and `localeCompare` and every `toLocale*` of strings, numbers, bigints, arrays and typed arrays;
 *  - any read of the globals in POISONED_GLOBALS (`Intl`, `Temporal`, `performance`, `crypto`, `fetch`, timers, …).
 * Two pure uses src/core makes all the time, `Date.UTC` and `new Date(value)`, are only witnessed: the first one seen
 * from src/core is noted, which proves the poison was live while src/core ran. A negative control can `forbid`
 * them, to show a real src/core call path is caught. `restore()` puts every original property back exactly.
 *
 * The guard is installed before any src/core module is evaluated (FR3-1): the poisoned run's setup file
 * (./core-poison-setup.ts) and core-poison.spec.ts install it first and only then load src/core, so a built-in src/core
 * captures or calls while its module loads is the twin, and a use made then is recorded like any other. It stays
 * installed; `disarm()` lets every call through (the unpoisoned baseline) until `arm()`. It reads the stack, compares
 * file names and records uses only through its own copies of the built-ins it needs (./core-poison-intrinsics.ts,
 * FR3-3), taken before src/core loads, so src/core cannot blind it by replacing one of them.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  append,
  call,
  each,
  pathOf,
  SAFE,
  setAdd,
  setHas,
  some,
  stackFiles,
  text,
} from './core-poison-intrinsics';

/** The directory whose files count as src/core. */
export const CORE_DIR = path.resolve(import.meta.dirname, '../../../src/core');
const CORE_PREFIX = `${CORE_DIR}${path.sep}`;
/** The guard's own files: never the caller. */
const GUARD_FILES: ReadonlySet<string> = new Set([
  fileURLToPath(import.meta.url),
  path.join(import.meta.dirname, 'core-poison-intrinsics.ts'),
]);
const DEPENDENCY = `${path.sep}node_modules${path.sep}`;
/**
 * The test runner's own packages. A frame in one of them is the harness, wherever it sits: Vitest's module runner
 * evaluates a src/core module's imports (and reads `performance` to time them) from inside that module's top-level
 * code, and src/core can reach none of these packages (it imports only its siblings and zod).
 */
const RUNNER = ['vitest', '@vitest', 'vite'].map((name) => `${DEPENDENCY}${name}${path.sep}`);

/** Globals src/core must never even read. Absent ones (Temporal in Node 22) are poisoned all the same. */
export const POISONED_GLOBALS = [
  'Intl',
  'Temporal',
  'performance',
  'crypto',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'WeakRef',
  'FinalizationRegistry',
] as const;

/** Date methods that read or write local time, or render text by the host's time zone or locale. */
const LOCAL_TIME_METHODS = [
  'getFullYear',
  'getYear',
  'getMonth',
  'getDate',
  'getDay',
  'getHours',
  'getMinutes',
  'getSeconds',
  'getMilliseconds',
  'getTimezoneOffset',
  'setFullYear',
  'setYear',
  'setMonth',
  'setDate',
  'setHours',
  'setMinutes',
  'setSeconds',
  'setMilliseconds',
  'toString',
  'toDateString',
  'toTimeString',
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
] as const;

/** An ISO 8601 timestamp with an explicit offset: the one text `new Date` reads the same way in every time zone. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
/** RegExp.prototype.exec, copied when this module loads (`test` reads `exec` off the regex at call time). */
const EXEC = SAFE.getOwnPropertyDescriptor(RegExp.prototype, 'exec')?.value as (
  this: RegExp,
  text: string,
) => RegExpExecArray | null;
const isoWithOffset = (value: string): boolean => call(EXEC, ISO_WITH_OFFSET, value) !== null;
/** ECMAScript's own Date Time String Format with an offset (milliseconds, when given, exactly three digits). */
const SPEC_ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const specIsoWithOffset = (value: string): boolean => call(EXEC, SPEC_ISO_WITH_OFFSET, value) !== null;

export class PoisonError extends Error {
  constructor(readonly use: string) {
    super(`src/core made an impure call: ${use} (Hard Rule 4)`);
    this.name = 'PoisonError';
  }
}

export type Origin = 'core' | 'harness';

/** Whether `file` is a src/core source file. */
export const inCore = (file: string): boolean => text.startsWith(file, CORE_PREFIX);

/** Who made a call, from its stack's file names, innermost first (see the file comment). */
export function originOf(files: readonly string[], isCore: (file: string) => boolean = inCore): Origin {
  return decide(files, isCore) ?? 'harness';
}

/** The origin the innermost deciding frame of `files` gives, or undefined when no frame decides. */
function decide(files: readonly string[], isCore: (file: string) => boolean): Origin | undefined {
  let origin: Origin | undefined;
  each(files, (name) => {
    const file = pathOf(name);
    const skip = file === '' || setHas(GUARD_FILES, file) || text.startsWith(file, 'node:');
    if (origin !== undefined || skip) return;
    if (some(RUNNER, (prefix) => text.includes(file, prefix))) origin = 'harness';
    else if (!text.includes(file, DEPENDENCY)) origin = isCore(file) ? 'core' : 'harness';
  });
  return origin;
}

/**
 * Frames read first: the caller is nearly always among them (the guard's own two or three frames, then the caller),
 * so the whole stack is read only when these hold no deciding frame (a dependency's deep call chain).
 */
const SHALLOW_FRAMES = 16;

/** Who called, from the stack: the first SHALLOW_FRAMES frames, then the whole stack if they did not decide. */
function callerOf(isCore: (file: string) => boolean): Origin {
  return decide(stackFiles(SHALLOW_FRAMES), isCore) ?? originOf(stackFiles(), isCore);
}

export interface PoisonOptions {
  /** Which files count as src/core (default: every file under src/core). */
  readonly isCore?: (file: string) => boolean;
  /** Witnessed uses to treat as impure (`'Date.UTC'`, `'new Date(value)'`): a negative control on real src/core. */
  readonly forbid?: readonly string[];
  /**
   * Whether to note the pure uses src/core makes (default true). Each one the harness makes before src/core does
   * reads the stack, so the poisoned run, which asserts only that nothing impure happened, turns it off.
   */
  readonly witness?: boolean;
  /**
   * Whether `Date.parse` of one ISO 8601 timestamp with an explicit offset counts as pure, as `new Date(text)` of one
   * does (default false: every `Date.parse` from src/core is caught). It gives the same instant on every host; lint
   * still bans `Date.parse` in src/core. The poisoned run turns it on: its harness parses millions of such
   * timestamps, and reading the stack for each would take hours.
   */
  readonly offsetParse?: boolean;
}

/** A property as it was before the poison: restored exactly (deleted when it did not exist). */
export type Saved = readonly [target: object, key: PropertyKey, before: PropertyDescriptor | undefined];

export interface Poison {
  /** Every impure use src/core made while the poison was installed and armed, in order. */
  readonly violations: readonly string[];
  /** The witnessed pure uses seen from src/core. */
  readonly witnessed: ReadonlySet<string>;
  /** Every property the poison replaced, with what it was before. */
  readonly saved: readonly Saved[];
  /** Lets every call through, unchecked, until `arm()` (the unpoisoned baseline). Installed armed. */
  disarm(): void;
  arm(): void;
  /** Puts every original back (once; later calls do nothing). */
  restore(): void;
}

interface Context {
  readonly saved: Saved[];
  /** Records and throws when src/core is the caller; otherwise does nothing. */
  readonly check: (use: string) => void;
  /** Notes the first use from src/core (or checks it, when forbidden). */
  readonly witness: (use: string) => void;
  /** PoisonOptions.offsetParse. */
  readonly offsetParse: boolean;
}

function patch(saved: Saved[], target: object, key: PropertyKey, descriptor: PropertyDescriptor): void {
  append(saved, [target, key, SAFE.getOwnPropertyDescriptor(target, key)] as const);
  if (!SAFE.defineProperty(target, key, { ...descriptor, configurable: true }))
    throw new Error(`poison: cannot replace ${text.of(key)}`);
}

/** Replaces method `key` of `target` by one that runs `before` with the same arguments, then the original. */
function wrapMethod(
  saved: Saved[],
  target: object,
  key: PropertyKey,
  before: (args: unknown[]) => void,
): void {
  const original: unknown = SAFE.getOwnPropertyDescriptor(target, key)?.value;
  if (typeof original !== 'function') throw new Error(`poison: no method ${text.of(key)} to wrap`);
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    before(args);
    return call(original as (...args: never[]) => unknown, this, ...args);
  };
  patch(saved, target, key, { value: wrapped, writable: true, enumerable: false });
}

/** Why `new Date(...args)` is impure, or null: one number, one Date or one ISO timestamp with an offset is not. */
function dateUse(args: readonly unknown[], RealDate: DateConstructor): string | null {
  if (args.length !== 1) return `new Date with ${text.of(args.length)} arguments`;
  const value = args[0];
  if (typeof value === 'number' || value instanceof RealDate) return null;
  if (typeof value === 'string' && isoWithOffset(value)) return null;
  return `new Date(${typeof value === 'string' ? 'text without an offset' : typeof value})`;
}

function poisonDate({ saved, check, witness, offsetParse }: Context): void {
  const RealDate = Date;
  const twin = new Proxy(RealDate, {
    apply(target, self, args): unknown {
      check('Date() called as a function');
      const result: unknown = SAFE.apply(target, self, args);
      return result;
    },
    construct(target, args, newTarget): object {
      const use = dateUse(args, RealDate);
      if (use === null) witness('new Date(value)');
      else check(use);
      const made: unknown = SAFE.construct(target, args, newTarget);
      if (!(made instanceof RealDate)) throw new Error('poison: Date made no Date');
      return made;
    },
  });
  patch(saved, globalThis, 'Date', { value: twin, writable: true, enumerable: false });
  patch(saved, RealDate.prototype, 'constructor', { value: twin, writable: true, enumerable: false });
  wrapMethod(saved, RealDate, 'now', () => {
    check('Date.now');
  });
  wrapMethod(saved, RealDate, 'parse', (args) => {
    const text = args[0];
    const offset = offsetParse && args.length === 1 && typeof text === 'string' && specIsoWithOffset(text);
    if (!offset) check('Date.parse');
  });
  wrapMethod(saved, RealDate, 'UTC', () => {
    witness('Date.UTC');
  });
  for (const name of LOCAL_TIME_METHODS) {
    wrapMethod(saved, RealDate.prototype, name, () => {
      check(`Date.prototype.${name}`);
    });
  }
  wrapMethod(saved, RealDate.prototype, Symbol.toPrimitive, (args) => {
    const hint = args[0];
    if (hint !== 'number') check(`Date.prototype[Symbol.toPrimitive](${text.json(hint)})`);
  });
}

function poisonLocales({ saved, check }: Context): void {
  const typedArray: unknown = Object.getPrototypeOf(Uint8Array.prototype);
  const targets: readonly (readonly [string, object | null, readonly string[]])[] = [
    ['Math', Math, ['random']],
    ['String', String.prototype, ['localeCompare', 'toLocaleUpperCase', 'toLocaleLowerCase']],
    ['Number', Number.prototype, ['toLocaleString']],
    ['BigInt', BigInt.prototype, ['toLocaleString']],
    ['Array', Array.prototype, ['toLocaleString']],
    ['TypedArray', typeof typedArray === 'object' ? typedArray : null, ['toLocaleString']],
  ];
  for (const [owner, target, names] of targets) {
    if (target === null) throw new Error('poison: no TypedArray prototype');
    for (const name of names) {
      wrapMethod(saved, target, name, () => {
        check(`${owner}.${name}`);
      });
    }
  }
}

function poisonGlobals({ saved, check }: Context): void {
  for (const name of POISONED_GLOBALS) {
    const before = SAFE.getOwnPropertyDescriptor(globalThis, name);
    const getter = before?.get;
    // An assignment (Vitest swaps its own timers in and out around each RPC) is kept here, so the twin stays.
    let assigned: { readonly value: unknown } | null = null;
    const read = (): unknown => {
      if (assigned !== null) return assigned.value;
      return getter === undefined ? before?.value : call(getter, globalThis);
    };
    patch(saved, globalThis, name, {
      enumerable: before?.enumerable ?? false,
      get: (): unknown => {
        check(name);
        return read();
      },
      set: (next: unknown): void => {
        assigned = { value: next };
      },
    });
  }
}

/** Installs the poison (see the file comment). Always `restore()` it, in a `finally` or an `afterAll`. */
export function installPoison(options: PoisonOptions = {}): Poison {
  const isCore = options.isCore ?? inCore;
  const forbid = new Set(options.forbid);
  const violations: string[] = [];
  const witnessed = new Set<string>();
  const saved: Saved[] = [];
  let armed = true;
  const fromCore = (): boolean => armed && callerOf(isCore) === 'core';
  const check = (use: string): void => {
    if (!fromCore()) return;
    append(violations, use);
    throw new PoisonError(use);
  };
  const noting = options.witness ?? true;
  const witness = (use: string): void => {
    if (setHas(forbid, use)) check(use);
    else if (noting && !setHas(witnessed, use) && fromCore()) setAdd(witnessed, use);
  };
  let restored = false;
  try {
    const context = { saved, check, witness, offsetParse: options.offsetParse ?? false };
    for (const install of [poisonDate, poisonLocales, poisonGlobals]) install(context);
  } catch (error) {
    restoreAll(saved);
    throw error;
  }
  return {
    violations,
    witnessed,
    saved,
    disarm(): void {
      armed = false;
    },
    arm(): void {
      armed = true;
    },
    restore(): void {
      if (restored) return;
      restored = true;
      restoreAll(saved);
    },
  };
}

/** Puts every saved property back, the last replaced first. */
function restoreAll(saved: readonly Saved[]): void {
  const reversed: Saved[] = [];
  each(saved, (entry, index) => {
    reversed[saved.length - 1 - index] = entry;
  });
  each(reversed, ([target, key, before]) => {
    if (before === undefined) SAFE.deleteProperty(target, key);
    else SAFE.defineProperty(target, key, before);
  });
}
