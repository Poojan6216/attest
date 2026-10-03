/**
 * check-docs rule 4 (QA-R14, QA-G15, TECH-C10, TECH-R5): docs/grading.md §15 is the whole golden file format, so
 * every key the strict scenario schema accepts must be written there. scripts/check-docs-scenario.ts reads the keys
 * from the schema's TypeScript source; this file proves that reading is complete against the real Zod schema at
 * runtime, that the real §15 names every key, and that the check reports each way §15 can fall behind.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { checkDocs } from '../../../../scripts/check-docs';
import {
  scenarioKeyProblems,
  schemaVocabulary,
  section15Vocabulary,
} from '../../../../scripts/check-docs-scenario';
import { Scenario } from '../../golden/scenario-schema';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const SCHEMA_TEXT = readFileSync(path.join(REPO_ROOT, 'extension/tests/golden/scenario-schema.ts'), 'utf8');
const GRADING_TEXT = readFileSync(path.join(REPO_ROOT, 'docs/grading.md'), 'utf8');

interface Walked {
  readonly keys: Set<string>;
  readonly literals: Set<string>;
}

/** Every object key and string literal of a Zod schema, read from the schema objects themselves (Zod 4 defs). */
function walkSchema(schema: z.ZodType): Walked {
  const walked: Walked = { keys: new Set(), literals: new Set() };
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null || seen.has(node) || !('_zod' in node)) return;
    seen.add(node);
    const def = (node as { _zod: { def: Record<string, unknown> & { type: string } } })._zod.def;
    if (def.type === 'object') {
      for (const [key, value] of Object.entries(def.shape as Record<string, unknown>)) {
        walked.keys.add(key);
        visit(value);
      }
    } else if (def.type === 'literal') {
      for (const value of def.values as unknown[]) if (typeof value === 'string') walked.literals.add(value);
    } else if (def.type !== 'lazy') {
      for (const value of Object.values(def)) (Array.isArray(value) ? value : [value]).forEach(visit);
    }
  };
  visit(schema);
  return walked;
}

describe('the real golden format is all in docs/grading.md §15', () => {
  it('reads from the schema source exactly the keys and event kinds the runtime Scenario schema accepts', () => {
    const runtime = walkSchema(Scenario);
    const source = schemaVocabulary(SCHEMA_TEXT);
    expect(runtime.keys.size).toBeGreaterThan(70);
    expect([...source.keys].sort()).toEqual([...runtime.keys].sort());
    expect([...source.literals].sort()).toEqual(['override', 'regrade', 'supersede']);
    expect([...source.literals].sort()).toEqual([...runtime.literals].sort());
  });

  it('finds every key and event kind in a §15 example, and counts each one', () => {
    const runtime = walkSchema(Scenario);
    expect(scenarioKeyProblems(SCHEMA_TEXT, GRADING_TEXT)).toEqual({
      problems: [],
      checked: runtime.keys.size + runtime.literals.size,
    });
    expect(checkDocs(REPO_ROOT).scenarioKeys).toBe(runtime.keys.size + runtime.literals.size);
  });
});

describe('schemaVocabulary: keys of object schemas only', () => {
  it('collects strictObject, object and looseObject keys at any depth, quoted or shorthand', () => {
    const source = [
      "import { z } from 'zod';",
      'const at = z.string();',
      "const Inner = z.object({ from: z.string(), 'to-x': z.string(), at });",
      'export const A = z.strictObject({ outer: z.array(z.looseObject({ inner: Inner })) });',
    ].join('\n');
    expect([...schemaVocabulary(source).keys].sort()).toEqual(['at', 'from', 'inner', 'outer', 'to-x']);
  });

  it('ignores plain objects, records and enums, and keeps only string literals held by a key', () => {
    const source = [
      "const TABLE = { 'match.best': { observationId: 'ref' } };",
      'const R = z.record(z.string(), z.number());',
      "const E = z.enum(['batch', 'grade']);",
      "const U = z.union([z.literal('free')]);",
      "const Ev = z.strictObject({ event: z.literal('regrade'), gone: z.literal(true).optional(),",
      "  kind: z.literal('late').optional().nullable() });",
    ].join('\n');
    const vocabulary = schemaVocabulary(source);
    expect([...vocabulary.keys].sort()).toEqual(['event', 'gone', 'kind']);
    expect([...vocabulary.literals].sort()).toEqual(['late', 'regrade']);
  });
});

describe('section15Vocabulary: only what §15 shows as JSON', () => {
  const doc = (section15: string) =>
    [
      '# G',
      '## 14. Before',
      '```jsonc',
      '{ "early": 1 }',
      '```',
      '## 15. Golden scenarios',
      'Prose names `prose` and "quoted": in text.',
      section15,
      '## 16. After',
      '```json',
      '{ "late": 1 }',
      '```',
    ].join('\n');

  it('reads JSON keys and strings from §15 code blocks, also inside list items, and nothing else', () => {
    const found = section15Vocabulary(
      doc('```jsonc\n{ "a": "x", "b" : ["y"] }\n```\n- item\n  ```json\n  { "c": 1 }\n  ```'),
    );
    expect(found?.line).toBe(6);
    expect([...(found?.keys ?? [])].sort()).toEqual(['a', 'b', 'c']);
    expect([...(found?.strings ?? [])].sort()).toEqual(['a', 'b', 'c', 'x', 'y']);
  });

  it('is null without a "## 15." heading', () => {
    expect(section15Vocabulary('# G\n\n## 15 Golden\n\n```json\n{ "a": 1 }\n```\n')).toBeNull();
  });
});

const SCHEMA = [
  "import { z } from 'zod';",
  "const Event = z.strictObject({ event: z.literal('regrade'), at: z.string() });",
  'export const Scenario = z.strictObject({ name: z.string(), events: z.array(Event) });',
].join('\n');
const SECTION = '## 15. Golden scenarios';
const COMPLETE = `# G\n\n${SECTION}\n\n\`\`\`jsonc\n{ "name": "…", "events": [{ "event": "regrade", "at": "…" }] }\n\`\`\`\n`;

describe('scenarioKeyProblems: each way §15 can fall behind the schema', () => {
  it('passes a §15 that shows every key and event kind', () => {
    expect(scenarioKeyProblems(SCHEMA, COMPLETE)).toEqual({ problems: [], checked: 5 });
  });

  it('reports each key and event kind §15 does not show, at the §15 heading, in code-unit order', () => {
    const grading = COMPLETE.replace('"at": "…"', '"when": "…"').replace('"regrade"', '"override"');
    const { problems } = scenarioKeyProblems(SCHEMA, grading);
    const schema = 'extension/tests/golden/scenario-schema.ts';
    expect(problems).toEqual([
      {
        file: 'docs/grading.md',
        line: 3,
        message: `scenario key 'at' from ${schema} is not in a §15 example (write "at": there)`,
      },
      {
        file: 'docs/grading.md',
        line: 3,
        message: `scenario value 'regrade' from ${schema} is not in a §15 example (write "regrade" there)`,
      },
    ]);
  });

  it('does not count a key that §15 names only in prose', () => {
    const grading = `${COMPLETE}\nThe \`at\` key and "at": in prose.\n`.replace(', "at": "…"', '');
    expect(scenarioKeyProblems(SCHEMA, grading).problems.map((p) => p.message)).toEqual([
      `scenario key 'at' from extension/tests/golden/scenario-schema.ts is not in a §15 example (write "at": there)`,
    ]);
  });

  it('reports a schema without §15, §15 without a schema, and a schema with no object keys', () => {
    const noSection = scenarioKeyProblems(SCHEMA, '# G\n\n## 14. Other\n');
    expect(noSection.problems.map((p) => `${p.file}: ${p.message}`)).toEqual([
      'docs/grading.md: no "## 15." section: every key of extension/tests/golden/scenario-schema.ts must be documented there',
    ]);
    expect(scenarioKeyProblems(null, COMPLETE).problems.map((p) => `${p.file}: ${p.message}`)).toEqual([
      'extension/tests/golden/scenario-schema.ts: missing: docs/grading.md §15 documents its keys',
    ]);
    expect(scenarioKeyProblems('export const Scenario = z.string();', COMPLETE).problems).toEqual([
      {
        file: 'extension/tests/golden/scenario-schema.ts',
        line: 0,
        message: 'no z.strictObject or z.object keys found',
      },
    ]);
  });

  it('checks nothing in a repository with neither, and leaves a missing grading.md to the rule-id check', () => {
    expect(scenarioKeyProblems(null, '# G\n')).toEqual({ problems: [], checked: 0 });
    expect(scenarioKeyProblems(SCHEMA, null)).toEqual({ problems: [], checked: 0 });
  });
});

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function fixtureRepo(grading: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'attest-check-docs-scenario-'));
  dirs.push(root);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ scripts: {} }),
    'extension/package.json': JSON.stringify({ scripts: {} }),
    'policy/default.json': JSON.stringify({ rules: [{ id: 'verified' }] }),
    'docs/grading.md': `${grading}\nRule \`verified\`.\n`,
    'extension/tests/golden/scenario-schema.ts': SCHEMA,
    'README.md': '# Attest\n',
    'PRIVACY.md': '# Privacy\n',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

describe('check-docs runs the golden format check', () => {
  it('reports a key missing from §15 as a docs/grading.md problem, and counts what it checked', () => {
    const clean = checkDocs(fixtureRepo(COMPLETE));
    expect(clean).toMatchObject({ problems: [], scenarioKeys: 5 });
    const broken = checkDocs(fixtureRepo(COMPLETE.replace('"name": "…", ', '')));
    expect(broken.problems.map((p) => [p.file, p.line, p.message])).toEqual([
      [
        'docs/grading.md',
        3,
        `scenario key 'name' from extension/tests/golden/scenario-schema.ts is not in a §15 example (write "name": there)`,
      ],
    ]);
  });
});
