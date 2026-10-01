// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import attest from './eslint-rules/index.js';

/** Hard Rule 3: no acting, no network, in anything that touches a vendor page. */
const ACT_SCOPES = ['entrypoints/content/**', 'src/adapters/**', 'src/observers/**'];

/** Files where MV3 listeners are registered. */
const LISTENER_SCOPES = ['entrypoints/background.ts', 'src/background/**', 'src/bus/**'];

/** Dexie is the storage layer; nothing outside the ledger (and crypto, Sprint 6) may import it. */
const DEXIE_ALLOWED = ['src/ledger/**', 'src/crypto/**', 'tests/**'];

const DEXIE_RESTRICTION = {
  name: 'dexie',
  message: 'Dexie is only imported in src/ledger (and src/crypto). Go through the ledger repos.',
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

const CORE_RESTRICTED_GLOBALS = [
  'chrome',
  'browser',
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
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
].map((name) => ({ name, message: `src/core is pure: '${name}' is not available here (Hard Rule 4).` }));

const CORE_RESTRICTED_SYNTAX = [
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
        projectService: true,
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
    files: DEXIE_ALLOWED,
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['src/log.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ACT_SCOPES,
    plugins: { attest },
    linterOptions: { noInlineConfig: true },
    rules: { 'attest/no-act': 'error' },
  },
  {
    files: LISTENER_SCOPES,
    plugins: { attest },
    linterOptions: { noInlineConfig: true },
    rules: { 'attest/top-level-listeners': 'error' },
  },
  {
    files: ['src/core/**'],
    linterOptions: { noInlineConfig: true },
    rules: {
      'no-restricted-imports': ['error', CORE_RESTRICTED_IMPORTS],
      'no-restricted-globals': ['error', ...CORE_RESTRICTED_GLOBALS],
      'no-restricted-syntax': ['error', ...CORE_RESTRICTED_SYNTAX],
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
