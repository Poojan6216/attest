// @ts-check
// Lints root-level tooling (bench/, scripts/). The extension has its own config in extension/.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// One source for the size limits and the `as unknown as` ban (tech_reviewer; TECH-C8): the extension config.
import { DOUBLE_ASSERTION_SYNTAX, SIZE_RULES } from './extension/eslint.config.js';

export default tseslint.config(
  { ignores: ['extension/**', 'telemetry-api/**', 'node_modules/**', 'bench/results/**'] },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      ...SIZE_RULES,
      'no-restricted-syntax': ['error', ...DOUBLE_ASSERTION_SYNTAX],
    },
  },
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },
  prettier,
);
