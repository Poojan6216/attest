/**
 * The runtime guard's own copies of the built-ins it relies on, and a snapshot of every built-in object (FR3-3,
 * Hard Rule 4). ./core-poison.ts reads who made a call from the stack; if src/core could replace what the guard reads
 * the stack with (`Error.captureStackTrace`, `Reflect.apply`, `Array.prototype.map`, `String.prototype.startsWith`),
 * it could blind the guard. So this module takes its own copy of each when it loads, which is before any src/core
 * module is evaluated (the poisoned run's setup file and core-poison.spec.ts import it first), and the guard calls
 * them only through these copies. It also snapshots the own properties, prototype and extensibility of globalThis
 * and every built-in constructor, prototype and namespace; `intrinsicChanges` lists what differs since, so a change
 * src/core makes to a built-in (itself impure: it changes what every later caller gets) fails the run.
 */

type Method = (...args: never[]) => unknown;

/** A built-in method, read off its owner when this module loads. */
function copyOf(target: object, key: PropertyKey): Method {
  const value: unknown = Reflect.getOwnPropertyDescriptor(target, key)?.value;
  if (typeof value !== 'function') throw new Error(`poison: no built-in ${String(key)} to copy`);
  return value as Method;
}

/** Built-ins the guard calls, copied when this module loads; methods are called only through `call`. */
const COPIES = {
  apply: Reflect.apply,
  construct: Reflect.construct,
  defineProperty: Reflect.defineProperty,
  deleteProperty: Reflect.deleteProperty,
  getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
  get: Reflect.get,
  getPrototypeOf: Reflect.getPrototypeOf,
  isExtensible: Reflect.isExtensible,
  ownKeys: Reflect.ownKeys,
  is: Object.is,
  freeze: Object.freeze,
  captureStackTrace: copyOf(Error, 'captureStackTrace') as (target: object, constructor?: unknown) => void,
  startsWith: copyOf(String.prototype, 'startsWith') as (this: string, prefix: string) => boolean,
  includes: copyOf(String.prototype, 'includes') as (this: string, part: string) => boolean,
  slice: copyOf(String.prototype, 'slice') as (this: string, from: number) => string,
  decodeURIComponent,
  String,
  stringify: JSON.stringify,
  setHas: copyOf(Set.prototype, 'has') as (this: ReadonlySet<unknown>, item: unknown) => boolean,
  setAdd: copyOf(Set.prototype, 'add') as (this: Set<unknown>, item: unknown) => Set<unknown>,
  push: copyOf(Array.prototype, 'push') as (this: unknown[], item: unknown) => number,
  isArray: Array.isArray,
  ErrorCtor: Error,
};

/**
 * Visits every element of `items` by index (a `for…of` would go through Array.prototype[Symbol.iterator] and the
 * array iterator's `next`, which src/core could replace).
 */
export function each<T>(items: readonly T[], visit: (item: T, index: number) => void): void {
  let index = 0;
  while (index < items.length) {
    const item = items[index];
    if (item !== undefined) visit(item, index);
    index += 1;
  }
}

/** Whether some element of `items` passes `test`, by index as `each` does. */
export function some<T>(items: readonly T[], test: (item: T) => boolean): boolean {
  let index = 0;
  while (index < items.length) {
    const item = items[index];
    if (item !== undefined && test(item)) return true;
    index += 1;
  }
  return false;
}

/** `fn` called with `self` and `args`, through the copied Reflect.apply (never `fn.call`, which src/core could change). */
export function call<T>(fn: (...args: never[]) => T, self: unknown, ...args: unknown[]): T {
  const result: unknown = COPIES.apply(fn, self, args);
  return result as T;
}

export const SAFE = COPIES;

/** `items` with `item` appended, by the copied Array.prototype.push. */
export function append<T>(items: T[], item: T): void {
  call(COPIES.push, items, item);
}

/** Whether `set` has `item`, by the copied Set.prototype.has. */
export function setHas<T>(set: ReadonlySet<T>, item: T): boolean {
  return call(COPIES.setHas, set, item);
}

/** Adds `item` to `set`, by the copied Set.prototype.add. */
export function setAdd<T>(set: Set<T>, item: T): void {
  call(COPIES.setAdd, set, item);
}

/** Text functions over the copies: src/core cannot change what the guard compares file names with. */
export const text = {
  startsWith: (value: string, prefix: string): boolean => call(COPIES.startsWith, value, prefix),
  includes: (value: string, part: string): boolean => call(COPIES.includes, value, part),
  slice: (value: string, from: number): string => call(COPIES.slice, value, from),
  of: (value: unknown): string => COPIES.String(value),
  json: (value: unknown): string => {
    const json: unknown = COPIES.stringify(value);
    return typeof json === 'string' ? json : 'undefined';
  },
};

type CallSiteLike = object;
type PrepareStackTrace = (error: Error, sites: CallSiteLike[]) => unknown;

/** The raw call sites of the current stack (V8), innermost first, with every guard setting put back after. */
function callSites(depth: number): readonly CallSiteLike[] {
  const { ErrorCtor, defineProperty, deleteProperty, getOwnPropertyDescriptor } = COPIES;
  const prepare = getOwnPropertyDescriptor(ErrorCtor, 'prepareStackTrace');
  const limit = getOwnPropertyDescriptor(ErrorCtor, 'stackTraceLimit');
  const holder: { stack?: unknown } = {};
  const raw: PrepareStackTrace = (_error, sites) => sites;
  try {
    const set =
      defineProperty(ErrorCtor, 'stackTraceLimit', { value: depth, writable: true, configurable: true }) &&
      defineProperty(ErrorCtor, 'prepareStackTrace', { value: raw, writable: true, configurable: true });
    if (!set)
      throw new COPIES.ErrorCtor('poison: src/core locked the stack API, so the guard cannot read callers');
    call(COPIES.captureStackTrace, ErrorCtor, holder);
    // V8 installs `stack` as an accessor that formats on first read: read it here, while `raw` is installed.
    const own = getOwnPropertyDescriptor(holder, 'stack');
    const sites: unknown = own?.get === undefined ? own?.value : call(own.get, holder);
    return COPIES.isArray(sites) ? (sites as CallSiteLike[]) : [];
  } finally {
    if (prepare === undefined) deleteProperty(ErrorCtor, 'prepareStackTrace');
    else defineProperty(ErrorCtor, 'prepareStackTrace', prepare);
    if (limit === undefined) deleteProperty(ErrorCtor, 'stackTraceLimit');
    else defineProperty(ErrorCtor, 'stackTraceLimit', limit);
  }
}

/** V8's CallSite.prototype.getFileName, copied from a stack read when this module loads. */
const GET_FILE_NAME = ((): ((this: CallSiteLike) => string | null | undefined) => {
  const [site] = callSites(1);
  const getter: unknown = site === undefined ? undefined : COPIES.getPrototypeOf(site);
  const method: unknown =
    typeof getter === 'object' && getter !== null
      ? COPIES.getOwnPropertyDescriptor(getter, 'getFileName')?.value
      : null;
  if (typeof method !== 'function') throw new Error('poison: no CallSite.prototype.getFileName');
  return method as (this: CallSiteLike) => string | null | undefined;
})();

/**
 * The file name of the innermost `depth` frames of the current stack (all of them by default), innermost first ('' for
 * native and eval'd code).
 */
export function stackFiles(depth = Infinity): string[] {
  const sites = callSites(depth);
  const files: string[] = [];
  each(sites, (site) => {
    const name = call(GET_FILE_NAME, site);
    append(files, typeof name === 'string' ? name : '');
  });
  return files;
}

/** `file://…` as a path, by the copied decodeURIComponent (no URL object src/core could reach). */
export function pathOf(name: string): string {
  return text.startsWith(name, 'file://') ? COPIES.decodeURIComponent(text.slice(name, 7)) : name;
}

/** One property as it stood: the fields of its descriptor. */
type Shape = readonly [key: PropertyKey, descriptor: PropertyDescriptor];

/**
 * The globals of ECMAScript itself, the ones of globalThis the snapshot compares (with the names a caller adds,
 * the guard's poisoned globals). The rest of globalThis belongs to the host and the test runner (Node's lazily
 * defined globals, the fake `chrome`, zod's registry) and changes as they run; src/core cannot reach globalThis.
 */
export const ECMASCRIPT_GLOBALS = [
  'globalThis', 'Infinity', 'NaN', 'undefined', 'eval', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'decodeURI',
  'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape', 'Object', 'Function', 'Array',
  'String', 'Number', 'BigInt', 'Boolean', 'Symbol', 'Date', 'RegExp', 'Error', 'EvalError', 'RangeError',
  'ReferenceError', 'SyntaxError', 'TypeError', 'URIError', 'AggregateError', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'Proxy', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
  'BigUint64Array', 'Iterator', 'Math', 'JSON', 'Reflect', 'Atomics',
] as const; // prettier-ignore

/** One built-in object as it stood: its own properties, its prototype and whether it was extensible. */
interface Standing {
  readonly label: string;
  readonly target: object;
  /** The keys compared, when not all of them (globalThis). */
  readonly only: readonly PropertyKey[] | null;
  readonly properties: readonly Shape[];
  readonly prototype: object | null;
  readonly extensible: boolean;
}

const isObject = (value: unknown): value is object =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';

/** A generator and an async function, to reach their prototypes. */
function* GENERATOR(): Generator<number> {
  yield 0;
}
async function ASYNC(): Promise<number> {
  return Promise.resolve(0);
}

/** Every built-in object a module can reach, by label (globalThis is added by snapshotIntrinsics). */
function builtIns(): (readonly [string, object])[] {
  const namespaces = ['Math', 'JSON', 'Reflect', 'Atomics'] as const;
  const constructors = [
    'Object', 'Function', 'Array', 'String', 'Number', 'BigInt', 'Boolean', 'Symbol', 'Date', 'RegExp',
    'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
    'AggregateError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'ArrayBuffer', 'SharedArrayBuffer',
    'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array',
    'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Iterator', 'TextEncoder',
    'TextDecoder', 'URL', 'URLSearchParams',
  ] as const; // prettier-ignore
  const out: (readonly [string, object])[] = [];
  const add = (label: string, value: unknown): void => {
    if (isObject(value)) append(out, [label, value] as const);
  };
  for (const name of namespaces) add(name, COPIES.getOwnPropertyDescriptor(globalThis, name)?.value);
  for (const name of constructors) {
    const value: unknown = COPIES.getOwnPropertyDescriptor(globalThis, name)?.value;
    add(name, value);
    if (isObject(value)) add(`${name}.prototype`, COPIES.getOwnPropertyDescriptor(value, 'prototype')?.value);
  }
  const typedArray: unknown = COPIES.getPrototypeOf(Uint8Array);
  add('%TypedArray%', typedArray);
  if (isObject(typedArray))
    add('%TypedArray%.prototype', COPIES.getOwnPropertyDescriptor(typedArray, 'prototype')?.value);
  const arrayIterator: unknown = COPIES.getPrototypeOf([][Symbol.iterator]());
  add('%ArrayIteratorPrototype%', arrayIterator);
  if (isObject(arrayIterator)) add('%IteratorPrototype%', COPIES.getPrototypeOf(arrayIterator));
  add('%StringIteratorPrototype%', COPIES.getPrototypeOf(''[Symbol.iterator]()));
  add('%MapIteratorPrototype%', COPIES.getPrototypeOf(new Map().entries()));
  add('%SetIteratorPrototype%', COPIES.getPrototypeOf(new Set().values()));
  add('%RegExpStringIteratorPrototype%', COPIES.getPrototypeOf(/a/g[Symbol.matchAll]('')));
  const generator = COPIES.getPrototypeOf(GENERATOR());
  if (generator !== null) add('%GeneratorPrototype%', COPIES.getPrototypeOf(generator));
  add('%AsyncFunction.prototype%', COPIES.getPrototypeOf(ASYNC));
  return out;
}

/** One object as it stands now (`only`: the keys compared, or null for all), for intrinsicChanges. */
export function standingOf(
  label: string,
  target: object,
  only: readonly PropertyKey[] | null = null,
): Standing {
  const properties: Shape[] = [];
  each(only ?? COPIES.ownKeys(target), (key) => {
    const descriptor = COPIES.getOwnPropertyDescriptor(target, key);
    if (descriptor !== undefined) append(properties, [key, COPIES.freeze({ ...descriptor })] as const);
  });
  return {
    label,
    target,
    only,
    properties,
    prototype: COPIES.getPrototypeOf(target),
    extensible: COPIES.isExtensible(target),
  };
}

/**
 * Every built-in object as it stands now, and on globalThis the ECMAScript globals and `globals` (take it before
 * src/core loads; compare with intrinsicChanges).
 */
export function snapshotIntrinsics(globals: readonly string[] = []): readonly Standing[] {
  const out: Standing[] = [standingOf('globalThis', globalThis, [...ECMASCRIPT_GLOBALS, ...globals])];
  each(builtIns(), ([label, target]) => {
    append(out, standingOf(label, target));
  });
  return out;
}

const FIELDS = ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'] as const;

function sameDescriptor(a: PropertyDescriptor, b: PropertyDescriptor): boolean {
  return !some(FIELDS, (field) => {
    const left: unknown = COPIES.get(a, field);
    const right: unknown = COPIES.get(b, field);
    return !COPIES.is(left, right);
  });
}

/** The descriptor of `key` in `shapes`, or undefined (a linear search over the copies: no Map src/core could change). */
function find(shapes: readonly Shape[], key: PropertyKey): PropertyDescriptor | undefined {
  let found: PropertyDescriptor | undefined;
  each(shapes, ([name, descriptor]) => {
    if (found === undefined && COPIES.is(name, key)) found = descriptor;
  });
  return found;
}

/** What differs between `before` and the built-ins now: `label.key added`, `… changed`, `… removed`, and the rest. */
export function intrinsicChanges(before: readonly Standing[]): string[] {
  const changes: string[] = [];
  each(before, ({ label, target, only, properties, prototype, extensible }) => {
    const now = standingOf(label, target, only);
    const name = (key: PropertyKey): string => `${label}.${text.of(key)}`;
    each(now.properties, ([key, descriptor]) => {
      const old = find(properties, key);
      if (old === undefined) append(changes, `${name(key)} added`);
      else if (!sameDescriptor(old, descriptor)) append(changes, `${name(key)} changed`);
    });
    each(properties, ([key]) => {
      if (find(now.properties, key) === undefined) append(changes, `${name(key)} removed`);
    });
    if (now.prototype !== prototype) append(changes, `${label} re-parented`);
    if (now.extensible !== extensible) append(changes, `${label} made non-extensible`);
  });
  return changes;
}
