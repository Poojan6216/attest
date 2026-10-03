// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import attest from './eslint-rules/index.js';
import {
  CORE_RESTRICTED_GLOBAL_NAMES,
  CORE_RESTRICTED_IMPORTS,
  CORE_RESTRICTED_SYNTAX,
} from './eslint-rules/core-fences.js';
import {
  ACT_RESTRICTED_IMPORTS,
  ACT_SCOPES,
  APP,
  APP_RESTRICTED_IMPORTS,
  appGlobals,
  DEXIE_ALLOWED,
  DEXIE_RESTRICTION,
  EXTRACTOR_RESTRICTED_IMPORTS,
  EXTRACTOR_SCOPES,
  LISTENER_SCOPES,
  MESSAGING_SYNTAX,
  NETWORK_EXEMPT_FILES,
  NODE_IMPORTS,
  NODE_TYPE_SYNTAX,
  restrictGlobals,
  WORKER_SCOPES,
} from './eslint-rules/fences.js';

/**
 * Lint fences. Flat config replaces (never merges) a rule's options when a later block sets it, so every
 * no-restricted-* list below is built per scope from the shared pieces (eslint-rules/fences.js for extension
 * code, eslint-rules/core-fences.js for src/core), and each scope's block sets the whole list.
 * tests/unit/lint/fences*.spec.ts prove each fence through this file.
 */

/**
 * Size limits (tech_reviewer: files ≤ 400 lines, functions ≤ 60 lines; TECH-C8, QA-G13, TECH-R6, TECH-R8), for
 * every file this config lints. Every line counts, blank and comment lines included, and every function counts,
 * the describe and it callbacks of a test file included (Decisions [1.v14-core]). The repo-root eslint.config.js
 * imports these for bench/ and scripts/. tests/unit/lint/size-rules.spec.ts proves both configs.
 * @type {import('eslint').Linter.RulesRecord}
 */
export const SIZE_RULES = {
  'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }],
  'max-lines-per-function': ['error', { max: 60, skipBlankLines: false, skipComments: false, IIFEs: true }],
};

/**
 * No `as unknown as` (tech_reviewer): it switches the type checker off for that value. Parse at the boundary with
 * Zod, or narrow. Every scope's no-restricted-syntax list below includes it (flat config replaces the list).
 */
export const DOUBLE_ASSERTION_SYNTAX = [
  {
    selector: "TSAsExpression > TSAsExpression.expression[typeAnnotation.type='TSUnknownKeyword']",
    message:
      'No `as unknown as`: it switches the type checker off. Parse with Zod or narrow the type instead (tech_reviewer).',
  },
];

/**
 * The only files exempt from the size limits: generated, never edited by hand, and as long as the Unicode
 * Character Database makes them. scripts/gen-unicode-baseline.ts (TABLE_FILES) writes exactly these, and is
 * itself held to the limits by the root config.
 */
export const GENERATED_FILES = [
  'src/core/unicode-table-assigned.ts',
  'src/core/unicode-table-classes.ts',
  'src/core/unicode-table-case.ts',
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
      ...SIZE_RULES,
      'no-restricted-syntax': ['error', ...DOUBLE_ASSERTION_SYNTAX],
    },
  },
  {
    files: GENERATED_FILES,
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
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
      'no-restricted-syntax': ['error', ...MESSAGING_SYNTAX, ...NODE_TYPE_SYNTAX, ...DOUBLE_ASSERTION_SYNTAX],
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
    rules: { 'no-restricted-syntax': ['error', ...NODE_TYPE_SYNTAX, ...DOUBLE_ASSERTION_SYNTAX] },
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
      'no-restricted-syntax': ['error', ...CORE_RESTRICTED_SYNTAX, ...DOUBLE_ASSERTION_SYNTAX],
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
