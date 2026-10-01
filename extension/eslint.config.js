// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import attest from './eslint-rules/index.js';

/**
 * Lint fences. Flat config replaces (never merges) a rule's options when a later block sets it, so every
 * no-restricted-* list below is built per scope from the shared pieces, and each scope's block sets the
 * whole list. tests/unit/lint/fences.spec.ts proves each fence through this file.
 */

/** Extension code: everything that ships. Inline disables have no effect anywhere here (Hard Rules 1–4, 10). */
const APP = ['src/**', 'entrypoints/**'];

/** Hard Rule 3: no acting, no network, no vendor storage, in anything that runs on a vendor page. */
const ACT_SCOPES = ['entrypoints/content/**', 'src/adapters/**', 'src/observers/**'];

/** The extractors themselves (`src/adapters/<vendor>/…`): pure over the DOM, no bus, no extension APIs. */
const EXTRACTOR_SCOPES = ['src/adapters/*/**', 'src/observers/*/**'];

/** Files where MV3 listeners are registered. */
const LISTENER_SCOPES = ['entrypoints/background.ts', 'src/background/**', 'src/bus/**'];

/** Code the service worker bundle runs: it has no DOM (TECH-V3). src/ledger is listed separately below. */
const WORKER_SCOPES = [
  'entrypoints/background.ts',
  'src/background/**',
  'src/bus/**',
  'src/config.ts',
  'src/setup.ts',
  'src/clock.ts',
  'src/log-vocabulary.ts',
];

/** Dexie is the storage layer; nothing outside the ledger (and crypto, Sprint 6) may import it. Tests may. */
const DEXIE_ALLOWED = ['src/ledger/**', 'src/crypto/**'];

/**
 * Hard Rule 1: the only files allowed to reach the network, one host each, and only when the user opts in:
 * the telemetry sender (Sprint 5.7) and the bring-your-own-key model provider (Sprint 5.3). Pinned by
 * fences.spec.ts; widening this list is a Decisions.md entry.
 */
const NETWORK_EXEMPT_FILES = ['src/telemetry/send.ts', 'src/intel/providers/byo.ts'];

const DEXIE_RESTRICTION = {
  name: 'dexie',
  message: 'Dexie is only imported in src/ledger (and src/crypto). Go through the ledger repos.',
};

/**
 * Extension code runs in Chrome, never Node (TECH-6). TypeScript cannot enforce this on its own: wxt's types
 * pull in vite's, which reference @types/node, so Node globals type-check in every file that imports
 * wxt/utils. These fences close that gap.
 */
const NODE_IMPORTS = {
  group: [
    'node:*',
    'fs',
    'fs/*',
    'path',
    'os',
    'http',
    'https',
    'net',
    'url',
    'util',
    'stream',
    'buffer',
    'child_process',
    'crypto',
    'worker_threads',
  ],
  message: 'Extension code runs in Chrome: no Node built-ins.',
};
const NODE_GLOBALS = [
  'Buffer',
  'process',
  'global',
  '__dirname',
  '__filename',
  'require',
  'setImmediate',
  'clearImmediate',
];
const NODE_TYPE_SYNTAX = [
  {
    selector: "TSQualifiedName[left.name='NodeJS']",
    message: 'Extension code runs in Chrome: no NodeJS types (use ReturnType<typeof setTimeout> etc.).',
  },
];

/** The default for extension code: no Dexie outside the ledger, no Node. */
const APP_RESTRICTED_IMPORTS = { paths: [DEXIE_RESTRICTION], patterns: [NODE_IMPORTS] };

/** Content scripts reach the ledger only through src/bus (TECH-2, SECURITY-V4). */
const ACT_RESTRICTED_IMPORTS = {
  paths: [DEXIE_RESTRICTION],
  patterns: [
    NODE_IMPORTS,
    { group: ['dexie/*'], message: 'Code on a vendor page never opens storage (Hard Rule 2).' },
    {
      regex: '(^|/)(ledger|background|crypto|telemetry|intel|ui)(/|$)',
      message:
        'Code on a vendor page posts to src/bus only; it never touches the ledger, worker, crypto, telemetry, model or UI code (Hard Rules 1, 2).',
    },
  ],
};

/** Extractors are pure over the DOM: no bus, no extension APIs (tech_reviewer; build_spec §7 contract). */
const EXTRACTOR_RESTRICTED_IMPORTS = {
  paths: [DEXIE_RESTRICTION, { name: 'wxt/browser', message: 'extract() is pure: no extension APIs.' }],
  patterns: [
    ...ACT_RESTRICTED_IMPORTS.patterns,
    {
      group: ['wxt/*', '@wxt-dev/*', 'webextension-polyfill'],
      message: 'extract() is pure: no extension APIs.',
    },
    { regex: '(^|/)bus(/|$)', message: 'extract() returns data; the content script posts it to the bus.' },
  ],
};

/**
 * src/core is pure (build_spec §6, Hard Rule 4): no chrome.*, no DOM, no Dexie, no I/O,
 * no clock, no randomness, and no imports from the impure layers.
 */
const CORE_RESTRICTED_IMPORTS = {
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
  ],
};

/**
 * Restricted globals, and the same names read off `window` / `globalThis` / `self` (aliasing them is the
 * same access).
 * @param {readonly string[]} names
 * @param {(name: string) => string} message
 */
function restrictGlobals(names, message) {
  names = [...new Set(names)];
  return {
    'no-restricted-globals': ['error', ...names.map((name) => ({ name, message: message(name) }))],
    'no-restricted-properties': [
      'error',
      ...names.flatMap((name) =>
        ['window', 'globalThis', 'self'].map((object) => ({
          object,
          property: name,
          message: message(name),
        })),
      ),
    ],
  };
}

/** Web storage: build_spec §5 allows Dexie (IndexedDB) and chrome.storage only (TECH-V2, Hard Rule 2). */
const WEB_STORAGE = ['localStorage', 'sessionStorage', 'caches', 'cookieStore', 'openDatabase'];
/** No DOM in the MV3 service worker or the modules it shares (TECH-V3, Hard Rule 6). */
const WORKER_DOM = [
  'window',
  'document',
  'alert',
  'confirm',
  'prompt',
  'XMLHttpRequest',
  'DOMParser',
  'Image',
  'Audio',
  'history',
  'requestAnimationFrame',
  'getComputedStyle',
  'matchMedia',
];

/** @param {{ indexedDB: boolean, console: boolean, dom: boolean }} allow */
function appGlobals(allow) {
  const names = [
    ...WEB_STORAGE,
    ...NODE_GLOBALS,
    ...(allow.indexedDB ? [] : ['indexedDB']),
    ...(allow.console ? [] : ['console']),
    ...(allow.dom ? [] : WORKER_DOM),
  ];
  return restrictGlobals(names, (name) => {
    if (name === 'console') return 'Log only through src/log.ts (Hard Rule 10).';
    if (name === 'indexedDB') return 'IndexedDB is the ledger: go through src/ledger (Dexie) (Hard Rule 2).';
    if (WEB_STORAGE.includes(name))
      return `'${name}' is not Attest storage: use the ledger or chrome.storage (build_spec §5).`;
    if (NODE_GLOBALS.includes(name)) return `'${name}' is Node: extension code runs in Chrome.`;
    return `'${name}' does not exist in the MV3 service worker (or code it shares).`;
  });
}

const CORE_RESTRICTED_GLOBAL_NAMES = [
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
  ...NODE_GLOBALS,
];

/** Runtime messaging only through src/bus (TECH-4, extension_engineer rule 2). */
const MESSAGING_NAMES =
  'sendMessage|onMessage|onMessageExternal|connect|onConnect|onConnectExternal|connectNative|sendNativeMessage';
const MESSAGING_SYNTAX = [
  {
    selector: `MemberExpression[property.name=/^(${MESSAGING_NAMES})$/]`,
    message:
      'Runtime messaging goes through src/bus (send, listen, query), never ad hoc (extension_engineer rule 2).',
  },
  {
    selector: `MemberExpression[computed=true][property.value=/^(${MESSAGING_NAMES})$/]`,
    message:
      'Runtime messaging goes through src/bus (send, listen, query), never ad hoc (extension_engineer rule 2).',
  },
];

const CORE_RESTRICTED_SYNTAX = [
  ...MESSAGING_SYNTAX,
  ...NODE_TYPE_SYNTAX,
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'src/core is pure: no clock. Pass time in as an argument.',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'src/core is pure: `new Date()` reads the clock. Pass time in as an argument.',
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

export default tseslint.config(
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
      'tests/fixtures/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        projectService: {
          // Root config files are Node code with their own tsconfig (TECH-6): not part of the browser project.
          allowDefaultProject: ['*.config.ts'],
          defaultProject: 'tsconfig.node.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Hard Rule 10: src/log.ts is the only logger.
      'no-console': 'error',
      // Hard Rule 9: no remote or dynamic code.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-imports': ['error', { paths: [DEXIE_RESTRICTION] }],
      // Security checklist: every catch logs with context; no empty catch blocks.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { ...globals.node },
    },
  },
  {
    files: ['tests/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Everything that ships: no network (HR1), no web storage or IndexedDB outside the ledger (HR2), no console
    // (HR10), no Node, no ad-hoc runtime messaging, literal log calls (HR10), and no inline disables
    // (SECURITY-V5).
    files: APP,
    plugins: { attest },
    linterOptions: { noInlineConfig: true },
    rules: {
      ...appGlobals({ indexedDB: false, console: false, dom: true }),
      'no-restricted-imports': ['error', APP_RESTRICTED_IMPORTS],
      'no-restricted-syntax': ['error', ...MESSAGING_SYNTAX, ...NODE_TYPE_SYNTAX],
      'attest/no-network': 'error',
      'attest/log-call': 'error',
    },
  },
  {
    files: DEXIE_ALLOWED,
    rules: { 'no-restricted-imports': ['error', { patterns: [NODE_IMPORTS] }] },
  },
  {
    files: ['src/crypto/**'],
    rules: appGlobals({ indexedDB: true, console: false, dom: true }),
  },
  {
    files: WORKER_SCOPES,
    rules: appGlobals({ indexedDB: false, console: false, dom: false }),
  },
  {
    files: ['src/ledger/**'],
    rules: appGlobals({ indexedDB: true, console: false, dom: false }),
  },
  {
    files: ['src/log.ts'],
    rules: { ...appGlobals({ indexedDB: false, console: true, dom: false }), 'no-console': 'off' },
  },
  {
    // src/bus is the one place runtime messaging lives.
    files: ['src/bus/**'],
    rules: { 'no-restricted-syntax': ['error', ...NODE_TYPE_SYNTAX] },
  },
  {
    files: NETWORK_EXEMPT_FILES,
    rules: { 'attest/no-network': 'off' },
  },
  {
    files: ACT_SCOPES,
    plugins: { attest },
    rules: {
      'attest/no-act': 'error',
      'no-restricted-imports': ['error', ACT_RESTRICTED_IMPORTS],
    },
  },
  {
    files: EXTRACTOR_SCOPES,
    ignores: ['src/adapters/base.ts', 'src/observers/base.ts'],
    rules: { 'no-restricted-imports': ['error', EXTRACTOR_RESTRICTED_IMPORTS] },
  },
  {
    files: LISTENER_SCOPES,
    plugins: { attest },
    rules: { 'attest/top-level-listeners': 'error' },
  },
  {
    files: ['src/core/**'],
    plugins: { attest },
    rules: {
      'no-restricted-imports': ['error', CORE_RESTRICTED_IMPORTS],
      ...restrictGlobals(
        CORE_RESTRICTED_GLOBAL_NAMES,
        (name) => `src/core is pure: '${name}' is not available here (Hard Rule 4).`,
      ),
      'no-restricted-syntax': ['error', ...CORE_RESTRICTED_SYNTAX],
      'attest/core-determinism': 'error',
    },
  },
  {
    // Node-side tooling and tests: Node globals; console output is the test runner's, not the extension's.
    files: ['tests/**', 'eslint-rules/**', '*.config.ts', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    // Playwright reads fixture dependencies from the first parameter's destructuring: `({}, use) => …`.
    files: ['tests/e2e/**'],
    rules: { 'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }] },
  },
  prettier,
);
