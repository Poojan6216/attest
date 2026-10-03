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
 * `OffsetAt`) counts as the harness, as it does in the extension.
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
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The directory whose files count as src/core. */
export const CORE_DIR = path.resolve(import.meta.dirname, '../../../src/core');
const THIS_FILE = fileURLToPath(import.meta.url);
const DEPENDENCY = /[\\/]node_modules[\\/]/;

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

export class PoisonError extends Error {
  constructor(readonly use: string) {
    super(`src/core made an impure call: ${use} (Hard Rule 4)`);
    this.name = 'PoisonError';
  }
}

export type Origin = 'core' | 'harness';

/** Whether `file` is a src/core source file. */
export const inCore = (file: string): boolean => file.startsWith(`${CORE_DIR}${path.sep}`);

/** Who made a call, from its stack's file names, innermost first (see the file comment). */
export function originOf(files: readonly string[], isCore: (file: string) => boolean = inCore): Origin {
  for (const name of files) {
    const file = name.startsWith('file://') ? fileURLToPath(name) : name;
    if (file === '' || file === THIS_FILE || file.startsWith('node:') || DEPENDENCY.test(file)) continue;
    return isCore(file) ? 'core' : 'harness';
  }
  return 'harness';
}

/** The file name of every frame of the current stack, innermost first ('' for native and eval'd code). */
function stackFiles(): string[] {
  const prepare = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
  const limit = Error.stackTraceLimit;
  const holder: { stack?: unknown } = {};
  let files: unknown;
  try {
    Error.stackTraceLimit = Infinity;
    Error.prepareStackTrace = (_error, sites) => sites.map((site) => site.getFileName() ?? '');
    Error.captureStackTrace(holder);
    files = holder.stack;
  } finally {
    if (prepare === undefined) Reflect.deleteProperty(Error, 'prepareStackTrace');
    else Object.defineProperty(Error, 'prepareStackTrace', prepare);
    Error.stackTraceLimit = limit;
  }
  return Array.isArray(files)
    ? files.filter((file: unknown): file is string => typeof file === 'string')
    : [];
}

export interface PoisonOptions {
  /** Which files count as src/core (default: every file under src/core). */
  readonly isCore?: (file: string) => boolean;
  /** Witnessed uses to treat as impure (`'Date.UTC'`, `'new Date(value)'`): a negative control on real src/core. */
  readonly forbid?: readonly string[];
}

/** A property as it was before the poison: restored exactly (deleted when it did not exist). */
export type Saved = readonly [target: object, key: PropertyKey, before: PropertyDescriptor | undefined];

export interface Poison {
  /** Every impure use src/core made while the poison was installed, in order. */
  readonly violations: readonly string[];
  /** The witnessed pure uses seen from src/core. */
  readonly witnessed: ReadonlySet<string>;
  /** Every property the poison replaced, with what it was before. */
  readonly saved: readonly Saved[];
  /** Puts every original back (once; later calls do nothing). */
  restore(): void;
}

interface Context {
  readonly saved: Saved[];
  /** Records and throws when src/core is the caller; otherwise does nothing. */
  readonly check: (use: string) => void;
  /** Notes the first use from src/core (or checks it, when forbidden). */
  readonly witness: (use: string) => void;
}

function patch(saved: Saved[], target: object, key: PropertyKey, descriptor: PropertyDescriptor): void {
  saved.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
  Object.defineProperty(target, key, { ...descriptor, configurable: true });
}

/** Replaces method `key` of `target` by one that runs `before` with the same arguments, then the original. */
function wrapMethod(
  saved: Saved[],
  target: object,
  key: PropertyKey,
  before: (args: unknown[]) => void,
): void {
  const original: unknown = Reflect.get(target, key);
  if (typeof original !== 'function') throw new Error(`poison: no method ${String(key)} to wrap`);
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    before(args);
    const result: unknown = Reflect.apply(original, this, args);
    return result;
  };
  patch(saved, target, key, { value: wrapped, writable: true, enumerable: false });
}

/** Why `new Date(...args)` is impure, or null: one number, one Date or one ISO timestamp with an offset is not. */
function dateUse(args: readonly unknown[], RealDate: DateConstructor): string | null {
  if (args.length !== 1) return `new Date with ${String(args.length)} arguments`;
  const [value] = args;
  if (typeof value === 'number' || value instanceof RealDate) return null;
  if (typeof value === 'string' && ISO_WITH_OFFSET.test(value)) return null;
  return `new Date(${typeof value === 'string' ? 'text without an offset' : typeof value})`;
}

function poisonDate({ saved, check, witness }: Context): void {
  const RealDate = Date;
  const twin = new Proxy(RealDate, {
    apply(target, self, args): unknown {
      check('Date() called as a function');
      const result: unknown = Reflect.apply(target, self, args);
      return result;
    },
    construct(target, args, newTarget): object {
      const use = dateUse(args, RealDate);
      if (use === null) witness('new Date(value)');
      else check(use);
      const made: unknown = Reflect.construct(target, args, newTarget);
      if (!(made instanceof RealDate)) throw new Error('poison: Date made no Date');
      return made;
    },
  });
  patch(saved, globalThis, 'Date', { value: twin, writable: true, enumerable: false });
  patch(saved, RealDate.prototype, 'constructor', { value: twin, writable: true, enumerable: false });
  wrapMethod(saved, RealDate, 'now', () => {
    check('Date.now');
  });
  wrapMethod(saved, RealDate, 'parse', () => {
    check('Date.parse');
  });
  wrapMethod(saved, RealDate, 'UTC', () => {
    witness('Date.UTC');
  });
  for (const name of LOCAL_TIME_METHODS) {
    wrapMethod(saved, RealDate.prototype, name, () => {
      check(`Date.prototype.${name}`);
    });
  }
  wrapMethod(saved, RealDate.prototype, Symbol.toPrimitive, ([hint]) => {
    if (hint !== 'number') check(`Date.prototype[Symbol.toPrimitive](${JSON.stringify(hint)})`);
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
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    const value: unknown = before?.value;
    const read = (): unknown => (before?.get === undefined ? value : before.get.call(globalThis));
    patch(saved, globalThis, name, {
      enumerable: before?.enumerable ?? false,
      get: (): unknown => {
        check(name);
        return read();
      },
      set: (next: unknown): void => {
        Object.defineProperty(globalThis, name, { value: next, writable: true, configurable: true });
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
  const fromCore = (): boolean => originOf(stackFiles(), isCore) === 'core';
  const check = (use: string): void => {
    if (!fromCore()) return;
    violations.push(use);
    throw new PoisonError(use);
  };
  const witness = (use: string): void => {
    if (forbid.has(use)) check(use);
    else if (!witnessed.has(use) && fromCore()) witnessed.add(use);
  };
  let restored = false;
  try {
    for (const install of [poisonDate, poisonLocales, poisonGlobals]) install({ saved, check, witness });
  } catch (error) {
    restoreAll(saved);
    throw error;
  }
  return {
    violations,
    witnessed,
    saved,
    restore(): void {
      if (restored) return;
      restored = true;
      restoreAll(saved);
    },
  };
}

function restoreAll(saved: readonly Saved[]): void {
  for (const [target, key, before] of [...saved].reverse()) {
    if (before === undefined) Reflect.deleteProperty(target, key);
    else Object.defineProperty(target, key, before);
  }
}
