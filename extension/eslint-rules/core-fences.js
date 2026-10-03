// @ts-check
/**
 * The src/core fences (build_spec §6, Hard Rule 4): what pure, deterministic code may import, which globals it may
 * not read, and which syntax reads a clock or randomness, reaches a constructor from a value (in any spelling,
 * destructuring included), reads an error stack, the stack API or `import.meta`, or reaches built-ins by `.call`,
 * `.apply`, `.bind`, `__proto__` or a built-in's `.prototype`. eslint.config.js applies them to src/core/** with
 * attest/core-determinism; tests/unit/lint/fences*.spec.ts prove them, and tests/unit/core/core-purity.spec.ts
 * checks the real files independently of lint.
 */
import {
  AMBIENT_SYNTAX,
  DEXIE_RESTRICTION,
  MESSAGING_SYNTAX,
  NODE_GLOBALS,
  NODE_TYPE_SYNTAX,
} from './fences.js';

/**
 * What src/core may import, as an allowlist (TECH-C2, Hard Rule 4): its own sibling modules (`./name`, no
 * extension, no subfolder), `zod`, and the shipped policy (`policy/default.json`, from src/core/policy.ts).
 * Everything else fails, including the modules next door that read the clock or the extension's
 * configuration (`../clock`, `../config`, `../setup`, `../log-vocabulary`). The named bans in
 * CORE_RESTRICTED_IMPORTS stay for their clearer messages. tests/unit/core/core-purity.spec.ts checks the
 * same allowlist on the real files.
 */
export const CORE_IMPORT_ALLOWLIST =
  '^(?!(?:\\./[a-z0-9-]+|zod|\\.\\./\\.\\./\\.\\./policy/default\\.json)$)';

/**
 * src/core is pure (build_spec §6, Hard Rule 4): no chrome.*, no DOM, no Dexie, no I/O,
 * no clock, no randomness, and no imports from the impure layers.
 */
export const CORE_RESTRICTED_IMPORTS = {
  paths: [
    DEXIE_RESTRICTION,
    { name: 'preact', message: 'src/core is pure: no UI.' },
    { name: 'ulidx', message: 'src/core is pure: ids derive from input hashes, never from randomness.' },
    { name: 'wxt', message: 'src/core is pure: no extension APIs.' },
  ],
  patterns: [
    {
      group: ['wxt/*', '@wxt-dev/*', 'webextension-polyfill', 'preact/*', 'dexie/*'],
      message: 'src/core is pure: no extension, UI, or storage libraries.',
    },
    {
      group: [
        'node:*',
        'fs',
        'fs/*',
        'path',
        'os',
        'http',
        'https',
        'net',
        'child_process',
        'crypto',
        'worker_threads',
      ],
      message: 'src/core is pure: no Node I/O or Node crypto. It must also run in the browser.',
    },
    {
      regex: '(^|/)(adapters|observers|ledger|bus|ui|telemetry|crypto|intel|background|entrypoints)(/|$)',
      message: 'src/core must not import from impure layers (adapters, observers, ledger, bus, ui, …).',
    },
    {
      regex: '(^|/)log(\\.ts)?$',
      message: 'src/core is pure: no logging. Return values; let the caller log.',
    },
    {
      regex: CORE_IMPORT_ALLOWLIST,
      caseSensitive: true,
      message:
        'src/core imports only its own modules (./name), zod and ../../../policy/default.json (Hard Rule 4). Pass anything else in as an argument.',
    },
  ],
};

export const CORE_RESTRICTED_GLOBAL_NAMES = [
  'chrome',
  'browser',
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'cookieStore',
  'openDatabase',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'performance',
  'crypto',
  'process',
  'globalThis',
  'self',
  'console',
  'Intl',
  // A clock and the host's time-zone database, in the browsers Attest runs in (PI-2).
  'Temporal',
  // Their results depend on when the garbage collector runs (TECH-C2).
  'WeakRef',
  'FinalizationRegistry',
  // A blocking wait with a timeout, and memory other threads write (FR3-3).
  'Atomics',
  'SharedArrayBuffer',
  ...NODE_GLOBALS,
];

/** Every way src/core could reach a constructor from a value: `new Date(0).constructor` is the clock (PI-3). */
const CONSTRUCTOR_MESSAGE =
  'src/core is pure: no `.constructor` (`new Date(0).constructor` is Date, with its clock). Name what you need (Hard Rule 4).';

/**
 * An error's stack and V8's stack API (FR3-3): `.stack` is host text (file paths, the engine's format), and the
 * others are the machinery the runtime guard (tests/unit/core/core-poison.ts) reads callers by.
 */
const STACK_NAMES = '^(stack|captureStackTrace|prepareStackTrace|stackTraceLimit)$';
const STACK_MESSAGE =
  "src/core is deterministic: no error stacks and no stack API (`.stack` is the host's file paths in the engine's format) (Hard Rule 4).";

/**
 * Ways to reach a built-in by a path the fences cannot follow (FR3-2): calling a function with another `this`
 * (`.call`, `.apply`, `.bind`), a built-in's prototype (`Number.prototype`), and `__proto__`. `Object.prototype` is
 * read only to tell a plain object (hash.ts). attest/core-determinism fences Reflect and Object themselves.
 */
const INDIRECT_MESSAGE =
  'src/core is pure: no `.call`, `.apply`, `.bind`, `__proto__` or built-in `.prototype` (they reach built-ins by a path the fences cannot follow). Call the method you mean on the value (Hard Rule 4).';
const INDIRECT_NAMES = '^(call|apply|bind|__proto__)$';

/**
 * One name banned however src/core spells it: member, computed or quoted key, template, destructured key.
 * @param {string} names An esquery regular expression, `/^(…)$/`.
 * @param {string} message
 */
const spellings = (names, message) =>
  [
    `MemberExpression[property.name=${names}]`,
    `Literal[value=${names}]`,
    `TemplateElement[value.cooked=${names}]`,
    `ObjectPattern > Property[key.name=${names}]`,
  ].map((selector) => ({ selector, message }));

export const CORE_RESTRICTED_SYNTAX = [
  ...MESSAGING_SYNTAX,
  ...NODE_TYPE_SYNTAX,
  ...AMBIENT_SYNTAX,
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'src/core is pure: no clock. Pass time in as an argument.',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'src/core is pure: `new Date()` reads the clock. Pass time in as an argument.',
  },
  {
    // `new Date(...args)` is `new Date()` when args is empty (PI-1).
    selector: "NewExpression[callee.name='Date'] > SpreadElement",
    message: 'src/core is pure: `new Date(...args)` reads the clock when args is empty. Pass one value.',
  },
  {
    // `new Date(y, m, d, …)` reads its fields in the host's time zone (PI-1).
    selector: "NewExpression[callee.name='Date'][arguments.length>1]",
    message:
      "src/core is deterministic: `new Date(y, m, …)` reads the host's time zone. Use Date.UTC(y, m, …).",
  },
  { selector: "MemberExpression[property.name='constructor']", message: CONSTRUCTOR_MESSAGE },
  { selector: "MemberExpression[computed=true][property.value='constructor']", message: CONSTRUCTOR_MESSAGE },
  { selector: "Literal[value='constructor']", message: CONSTRUCTOR_MESSAGE },
  { selector: "TemplateElement[value.cooked='constructor']", message: CONSTRUCTOR_MESSAGE },
  // `const { constructor } = /a/` and `const { constructor: C } = new Date(0)` (UNI-R3-3).
  { selector: "ObjectPattern > Property[key.name='constructor']", message: CONSTRUCTOR_MESSAGE },
  ...spellings(`/${STACK_NAMES}/`, STACK_MESSAGE),
  {
    selector: "MetaProperty[meta.name='import']",
    message: "src/core is pure: no `import.meta` (it is the host's module URL) (Hard Rule 4).",
  },
  ...spellings(`/${INDIRECT_NAMES}/`, INDIRECT_MESSAGE),
  {
    selector: "MemberExpression[property.name='prototype']:not([object.name='Object'])",
    message: INDIRECT_MESSAGE,
  },
  { selector: "MemberExpression[computed=true][property.value='prototype']", message: INDIRECT_MESSAGE },
  {
    // `date[Symbol.toPrimitive]('string')` renders a Date in the host's time zone (PI-4).
    selector: "MemberExpression[object.name='Symbol'][property.name='toPrimitive']",
    message:
      "src/core is deterministic: no Symbol.toPrimitive (a Date's renders the host's time zone) (Hard Rule 4).",
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message: 'src/core is pure: `Date()` reads the clock.',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'src/core is pure: no randomness. Derive ids from input hashes.',
  },
  {
    selector: "MemberExpression[property.name='getRandomValues']",
    message: 'src/core is pure: no randomness.',
  },
  {
    selector: "MemberExpression[property.name='randomUUID']",
    message: 'src/core is pure: no randomness.',
  },
  {
    selector: 'ImportExpression',
    message: 'src/core is pure: no dynamic import.',
  },
];
