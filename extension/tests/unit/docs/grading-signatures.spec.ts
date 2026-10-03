/**
 * docs/grading.md is the contract (TECH-C9): the signatures it gives for `isFinalizable` (§8, §13), `priorSpendCents`
 * (§6.3, §13) and `spendIndex` (§13) are the ones the code exports, read from the TypeScript source, and the §6.1
 * `amountAboveCeiling` row never calls the condition "not applicable" inside its guard, where the code returns true
 * or false (conditions-scope.ts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const DOC = readFileSync(path.join(EXTENSION, '..', 'docs', 'grading.md'), 'utf8');

function sourceOf(file: string): ts.SourceFile {
  const text = readFileSync(path.join(EXTENSION, 'src', 'core', file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** `name` or `name?` for each member of an exported interface, in declaration order. */
function interfaceMembers(file: string, name: string): string[] {
  const declaration = sourceOf(file).statements.find(
    (node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === name,
  );
  if (declaration === undefined) throw new Error(`no interface ${name} in ${file}`);
  return declaration.members.map((member) => {
    const text = member.name?.getText() ?? '';
    return member.questionToken === undefined ? text : `${text}?`;
  });
}

/** `name(a, b, c?)` for an exported function, from its declared parameters. */
function signature(file: string, name: string): string {
  const declaration = sourceOf(file).statements.find(
    (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  if (declaration === undefined) throw new Error(`no function ${name} in ${file}`);
  const params = declaration.parameters.map(
    (param) => `${param.name.getText()}${param.questionToken === undefined ? '' : '?'}`,
  );
  return `${name}(${params.join(', ')})`;
}

/** The text of one section, from its `## <n>.` heading to the next level-2 heading. */
function section(n: number): string {
  const start = DOC.indexOf(`\n## ${String(n)}. `);
  const end = DOC.indexOf('\n## ', start + 1);
  if (start === -1) throw new Error(`no §${String(n)}`);
  return DOC.slice(start, end === -1 ? undefined : end);
}

describe('docs/grading.md gives the signatures the code exports', () => {
  it('writes isFinalizable with exactly the FinalityInput members, in §8 and §13', () => {
    const members = interfaceMembers('conditions-finality.ts', 'FinalityInput');
    expect(members).toContain('eligible?');
    const written = `isFinalizable({${members.join(', ')}})`;
    for (const n of [8, 13]) expect(section(n), `§${String(n)}`).toContain(written);
    const everyCall = [...DOC.matchAll(/isFinalizable\(([^)]*)\)/g)].map((match) => match[0]);
    expect(everyCall.length).toBeGreaterThanOrEqual(2);
    expect(new Set(everyCall)).toEqual(new Set([written]));
  });

  it('writes priorSpendCents and spendIndex with their parameters, in §6.3 and §13', () => {
    const prior = signature('scope.ts', 'priorSpendCents');
    expect(prior).toBe('priorSpendCents(claim, claims, policy, spendCurrency?)');
    expect(section(6)).toContain(`\`${prior}\``);
    expect(section(13)).toContain(`\`${prior}\``);
    expect(section(13)).toContain(`\`${signature('scope.ts', 'spendIndex')}\``);
  });
});

describe('docs/grading.md §6.1 amountAboveCeiling', () => {
  it('is true or false inside its guard, never "not applicable" there', () => {
    const row = section(6)
      .split('\n')
      .find((line) => line.startsWith('| `amountAboveCeiling` |'));
    expect(row).toBeDefined();
    const [, insideGuard = ''] = (row ?? '').split('within the guard it is true or false');
    expect(insideGuard).not.toBe('');
    expect(insideGuard).not.toMatch(/not applicable/i);
    expect(insideGuard).toMatch(/Otherwise false\. \|$/);
  });
});
