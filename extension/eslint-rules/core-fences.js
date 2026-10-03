// @ts-check
/**
 * The src/core fences (build_spec §6, Hard Rule 4): what pure, deterministic code may import, which globals it may
 * not read, and which syntax reads a clock or randomness. eslint.config.js applies them to src/core/** with
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
  ...NODE_GLOBALS,
];

/** Every way src/core could reach a constructor from a value: `new Date(0).constructor` is the clock (PI-3). */
const CONSTRUCTOR_MESSAGE =
  'src/core is pure: no `.constructor` (`new Date(0).constructor` is Date, with its clock). Name what you need (Hard Rule 4).';

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
