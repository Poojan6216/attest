// @ts-check
/**
 * The global names src/core may and may not read, in one place for the checks that must agree on them (FS-1,
 * R4-FENCE-1, R4-FENCE-2; Hard Rules 1 and 4). The grep test (tests/unit/core/core-scan-globals.ts) and the runtime
 * guard (tests/unit/core/core-poison-globals.ts) read them from here, so neither can drift from eslint.config.js:
 * NETWORK_GLOBALS and NETWORK_PROPERTIES are attest/no-network's, CORE_RESTRICTED_GLOBAL_NAMES is src/core's
 * no-restricted-globals list, and CORE_ALLOWED_GLOBALS is the allowlist attest/core-globals and the grep test hold
 * every other global read in src/core to.
 */
export { NETWORK_GLOBALS, NETWORK_PROPERTIES } from './scope-globals.js';
export { CORE_RESTRICTED_GLOBAL_NAMES } from './core-fences.js';

/**
 * The ECMAScript 2023 built-ins src/core may not read although they are no host's: each runs text as code or reaches
 * the engine by a path the fences cannot follow. Every other ES2023 built-in src/core may not read is on
 * CORE_RESTRICTED_GLOBAL_NAMES (`globalThis`, `Intl`, `WeakRef`, `FinalizationRegistry`, `Atomics`,
 * `SharedArrayBuffer`), with its reason there.
 */
export const CORE_UNSAFE_BUILTINS = new Set([
  // Code built from text at run time (Hard Rule 9); `Function('return this')()` is the global object.
  'eval',
  'Function',
  // A Proxy's traps run inside the engine's own operations on a value, as reflection does (FR3-2).
  'Proxy',
  // Annex B's legacy text encodings: optional in the language, and src/core needs neither.
  'escape',
  'unescape',
]);

/**
 * Every global src/core may read (R4-FENCE-1, R4-FENCE-2): the ECMAScript 2023 built-ins (TypeScript's lib.es2023,
 * the only lib src/core/tsconfig.json loads) less CORE_RESTRICTED_GLOBAL_NAMES and CORE_UNSAFE_BUILTINS. Anything
 * else, a host's name above all (`Image`, `Audio`, `FontFace`, `Worker`, `clientInformation`, `open`, `top`,
 * `postMessage`, `BroadcastChannel`, `Notification`, …), fails, whether or not a list names it, unless the file
 * declares or imports it. `Date`, `Math`, `Reflect` and `Object` stay under their own rules (attest/core-determinism
 * and the grep test's patterns). tests/unit/core/core-purity-allowlist.spec.ts derives the list again from
 * TypeScript's lib and fails when they differ.
 */
export const CORE_ALLOWED_GLOBALS = new Set([
  'undefined',
  'NaN',
  'Infinity',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'Object',
  'Boolean',
  'Symbol',
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Number',
  'BigInt',
  'Math',
  'Date',
  'String',
  'RegExp',
  'Array',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'ArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'JSON',
  'Promise',
  'Reflect',
]);
