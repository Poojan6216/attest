/**
 * Sprint 0.8 Done-when: src/core typechecks without DOM types. src/core/tsconfig.json compiles core
 * with only the ES2023 lib, no ambient @types (no Node), and no JSX runtime (preact's types pull in
 * lib.dom). These tests prove the config is DOM-free by showing that a DOM or Node reference fails.
 */
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const EXTENSION_ROOT = path.resolve(import.meta.dirname, '../../..');
const CORE_TSCONFIG = path.join(EXTENSION_ROOT, 'src', 'core', 'tsconfig.json');
const COMPILE_TIMEOUT_MS = 60_000;

function loadCoreConfig(): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    CORE_TSCONFIG,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (!parsed) throw new Error('src/core/tsconfig.json did not parse');
  expect(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  return parsed;
}

function messages(diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

/** Compiles `source` as if it were a file in src/core, under the core config. */
function compileProbe(
  config: ts.ParsedCommandLine,
  source: string,
): { program: ts.Program; diagnostics: string[] } {
  const probePath = path.join(EXTENSION_ROOT, 'src', 'core', '__dom_probe__.ts');
  const host = ts.createCompilerHost(config.options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === probePath
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  host.fileExists = (fileName) => fileName === probePath || fileExists(fileName);
  const program = ts.createProgram([probePath], config.options, host);
  return {
    program,
    diagnostics: messages(ts.getPreEmitDiagnostics(program, program.getSourceFile(probePath))),
  };
}

describe('src/core/tsconfig.json is DOM-free', () => {
  it('uses only the ES2023 lib, no ambient types, no JSX runtime', () => {
    const { options, fileNames } = loadCoreConfig();
    expect(options.lib).toEqual(['lib.es2023.d.ts']);
    expect(options.types).toEqual([]);
    expect(options.jsx).toBeUndefined();
    expect(options.jsxImportSource).toBeUndefined();
    expect(fileNames).toContain(path.join(EXTENSION_ROOT, 'src', 'core', 'policy.ts'));
  });

  it(
    'src/core typechecks under it without pulling in lib.dom or preact',
    () => {
      const config = loadCoreConfig();
      const program = ts.createProgram(config.fileNames, config.options);
      expect(messages(ts.getPreEmitDiagnostics(program))).toEqual([]);
      const loaded = program.getSourceFiles().map((file) => file.fileName);
      expect(loaded.some((file) => file.endsWith('/lib.dom.d.ts'))).toBe(false);
      expect(loaded.some((file) => file.includes('/preact/'))).toBe(false);
      expect(loaded.some((file) => file.includes('/@types/node/'))).toBe(false);
    },
    COMPILE_TIMEOUT_MS,
  );

  it(
    'a DOM or Node reference in src/core fails to typecheck',
    () => {
      const { diagnostics } = compileProbe(
        loadCoreConfig(),
        'export const title: string = document.title;\nexport const env: unknown = process.env;\n',
      );
      expect(diagnostics.some((message) => message.startsWith("Cannot find name 'document'."))).toBe(true);
      expect(diagnostics.some((message) => message.startsWith("Cannot find name 'process'."))).toBe(true);
      expect(diagnostics).toHaveLength(2);
    },
    COMPILE_TIMEOUT_MS,
  );

  it(
    'a plain ES2023 probe compiles cleanly (the probe harness itself works)',
    () => {
      const { diagnostics } = compileProbe(
        loadCoreConfig(),
        'export const sorted: readonly number[] = [1, 0].toSorted((a, b) => a - b);\n',
      );
      expect(diagnostics).toEqual([]);
    },
    COMPILE_TIMEOUT_MS,
  );
});
