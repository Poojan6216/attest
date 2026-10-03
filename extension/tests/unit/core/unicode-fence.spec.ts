/**
 * SEC-1 (Hard Rule 4): src/core never reads a character property from the engine. Every `\p{…}` class, `\s`,
 * `trim()`, case mapping and normalisation follows the Unicode version of the engine running it; src/core reads
 * character classes from the Unicode 15.0 tables (unicode-baseline.ts) instead. unicode-fence-scan.ts walks the
 * TypeScript syntax tree of every file in src/core and its subdirectories but the generated tables, so a comment
 * never hides or fakes a finding and a `//` inside a string is only a string; src/core may hold no other kind of
 * source (unicode-fence-files.ts). It refuses:
 *  - `\p{…}` / `\P{…}` other than `ASCII` and `Cc` (both fixed forever), and `\s` / `\S` (whatever follows it), in a
 *    regular expression literal, in string and template text as written and as read, in any text the file composes
 *    statically (a template, a `+`, a `const`), and in every pattern a `RegExp` is built from;
 *  - Unicode case folding: an inline modifier group (`(?i:…)`, `(?-i:…)`), whatever the flags; a regular
 *    expression with the `i` flag and `u` or `v`; and one with `i` whose pattern is not plain ASCII or holds a
 *    backreference (`\1`, `\k<name>`): without `u`, `i` still folds by the engine's case tables, and a
 *    backreference compares captured text, which may be any character, by them;
 *  - a regular expression built from text known only at run time. `RegExp(…)` and `new RegExp(…)` take a string
 *    literal for the flags (then the case-folding rule applies to it) and, for the pattern, a string literal or a
 *    template whose every substitution is a `BASELINE_CLASS` member imported from src/core/unicode-baseline.ts, a
 *    generated 15.0 table imported by name, or a `const` declared once in the file and built the same way; a `+`
 *    is refused. Any other use of `RegExp`, `compile`, and `match`, `matchAll` or `search` called with anything but
 *    a regular expression or read to call later (`.call`, `.apply`, `.bind`, destructured), are refused;
 *  - `toUpperCase`, the locale case mappings, `localeCompare` and `Intl`, called or only referenced, and any string
 *    the file spells that names one of these methods (`Reflect.get(s, 'normalize')`);
 *  - `trim` and `toLowerCase` anywhere but the uses ENGINE_CASE_AND_TRIM lists, each by file, function and line,
 *    and each met exactly once;
 *  - `normalize` outside the three reader files, whose every export the later-engine property
 *    (tests/property/unicode-baseline.property.spec.ts) runs: it checks that none is left out.
 * ESLint closes the rest: the core fences refuse `globalThis` and `.constructor`, and the type-aware unbound-method
 * rule refuses any other read of a method's value (`const m = s.match`, `[s.normalize]`). No file is
 * exempt: policy-schema.ts and schema-text.ts read `BASELINE_CLASS` (Decisions [SEC-1]), there is no pending list,
 * and an exemption may not be added. unicode-fence-controls.spec.ts and unicode-fence-pins.spec.ts show the scan
 * finds what it looks for, one probe at a time.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { coreFiles, READER_FILES } from './unicode-fence-files';
import { type Finding, findings, TABLE_SOURCES } from './unicode-fence-scan';

const CORE = path.resolve(import.meta.dirname, '../../../src/core');

/**
 * Every `trim()` and `toLowerCase()` src/core may call, as `file | function | line | rule`, each to be met exactly
 * once: in normalize-text.ts on text an ASCII test (`^\p{ASCII}*$`) has just passed, so no Unicode is in it; in
 * unicode-baseline.ts, `trimBaseline` and `lowerBaseline` on ASCII text, and `lowerBaseline` (through `lowerPoint`
 * for the code points it keeps) on text `asBaseline` prepared, once final sigma is decided from the 15.0 tables.
 */
const ENGINE_CASE_AND_TRIM: readonly string[] = [
  "normalize-text.ts | asciiName | return raw.toLowerCase().replace(ASCII_WHITESPACE_RUN, ' ').trim(); | lowercase",
  "normalize-text.ts | asciiName | return raw.toLowerCase().replace(ASCII_WHITESPACE_RUN, ' ').trim(); | trim",
  'normalize-text.ts | subjectTokens | ? raw.toLowerCase().split(ASCII_NON_TOKEN) | lowercase',
  'unicode-baseline.ts | trimBaseline | if (!NON_ASCII.test(text)) return text.trim(); | trim',
  'unicode-baseline.ts | lowerPoint | const lower = point.toLowerCase(); | lowercase',
  'unicode-baseline.ts | lowerBaseline | if (!NON_ASCII.test(text)) return text.toLowerCase(); | lowercase',
  'unicode-baseline.ts | lowerBaseline | const lower = decided.toLowerCase(); | lowercase',
];

const keyOf = ({ file, within, text, rule }: Finding): string => `${file} | ${within} | ${text} | ${rule}`;

/** What the fence holds against `found`: findings it refuses, and the engine case and trim uses, as keys. */
function verdict(found: readonly Finding[]): { refused: Finding[]; caseAndTrim: string[] } {
  const normalises = ({ file, rule }: Finding): boolean => rule === 'normalize' && READER_FILES.has(file);
  const listed = (finding: Finding): boolean => ENGINE_CASE_AND_TRIM.includes(keyOf(finding));
  const caseAndTrim = found.filter(({ rule }) => rule === 'trim' || rule === 'lowercase');
  return {
    refused: found.filter((finding) => !normalises(finding) && !listed(finding)),
    caseAndTrim: caseAndTrim.map(keyOf).sort(),
  };
}

const { sources, tables, others } = coreFiles(CORE, TABLE_SOURCES);
const found = sources.flatMap((file) => findings(file, readFileSync(path.join(CORE, file), 'utf8')));

describe('src/core reads no character property from the engine', () => {
  it('every use in src/core is a reader normalisation or a listed case or trim, each met exactly once', () => {
    expect(sources.length).toBeGreaterThan(50);
    const { refused, caseAndTrim } = verdict(found);
    expect(refused).toEqual([]);
    expect(caseAndTrim).toEqual([...ENGINE_CASE_AND_TRIM].sort());
    // Each reader file normalises (the scan reads the files it allows), and no other file does.
    const normalising = new Set(found.filter(({ rule }) => rule === 'normalize').map(({ file }) => file));
    expect([...normalising].sort()).toEqual([...READER_FILES].sort());
  });

  it('a listed use is matched by file, function and line, and only as often as it is listed', () => {
    const line = "return raw.toLowerCase().replace(ASCII_WHITESPACE_RUN, ' ').trim();";
    const asciiName = `function asciiName(raw: string): string {\n  ${line}\n}`;
    const elsewhere = `export function currencyWord(raw: string): string {\n  ${line}\n}`;
    const extra = (file: string, text: string): Finding[] => [...found, ...findings(file, text)];
    expect(verdict(extra('normalize-amount.ts', elsewhere)).refused).toHaveLength(2);
    expect(verdict(extra('normalize-amount.ts', asciiName)).refused).toHaveLength(2);
    expect(verdict(extra('normalize-text.ts', elsewhere)).refused).toHaveLength(2);
    const twice = verdict(extra('normalize-text.ts', asciiName));
    expect(twice.refused).toEqual([]);
    expect(twice.caseAndTrim).not.toEqual([...ENGINE_CASE_AND_TRIM].sort());
  });

  it('names the declaration each finding is in: its function, else its top-level statement', () => {
    const text = [
      "const UPPER = 'a'.toUpperCase();",
      'const upper = (s: string) => s.toUpperCase();',
      'export function outer(s: string) {',
      '  function inner(t: string) { return t.toUpperCase(); }',
      '  return inner(s).toUpperCase();',
      '}',
      "export default 'a'.toUpperCase();",
    ].join('\n');
    expect(findings('x.ts', text).map(({ line, within }) => [line, within])).toEqual([
      [1, 'UPPER'],
      [2, 'upper'],
      [4, 'inner'],
      [5, 'outer'],
      [7, ''],
    ]);
  });

  it('src/core holds only TypeScript sources, in every directory (but its tsconfig.json)', () => {
    expect(others).toEqual([]);
  });

  it('skips only the tables scripts/gen-unicode-baseline.ts generates (unicode-tables.spec.ts checks them)', () => {
    expect(TABLE_SOURCES.size).toBe(3);
    expect(tables).toEqual([...TABLE_SOURCES].sort());
    const named = [...sources, ...tables, ...others].filter((file) =>
      path.posix.basename(file).startsWith('unicode-table-'),
    );
    expect(named).toEqual([...TABLE_SOURCES].sort());
  });
});

describe('the fence reads every directory under src/core', () => {
  it('lists .ts sources at any depth, the top-level tables apart, and reports every other file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'attest-unicode-fence-'));
    try {
      const files = [
        'a.ts',
        'text/deep/b.ts',
        'text/unicode-table-case.ts',
        'unicode-table-case.ts',
        'tsconfig.json',
        'text/tsconfig.json',
        'c.js',
        'text/d.mts',
        'e.cts',
        'f.tsx',
        'g.TS',
      ];
      for (const file of files) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), '');
      }
      expect(coreFiles(root, TABLE_SOURCES)).toEqual({
        sources: ['a.ts', 'text/deep/b.ts', 'text/unicode-table-case.ts'],
        tables: ['unicode-table-case.ts'],
        others: ['c.js', 'e.cts', 'f.tsx', 'g.TS', 'text/d.mts', 'text/tsconfig.json'],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds a use in a subdirectory file, and trusts only the top-level baseline and tables there', () => {
    const fold = [
      'const LETTER = /\\p{L}/u;',
      "export function fold(text: string): string { return LETTER.test(text) ? text.normalize('NFKC').toLowerCase().trim() : text; }",
    ].join('\n');
    expect(findings('text/fold.ts', fold).map(({ rule }) => rule)).toEqual([
      'property',
      'trim',
      'lowercase',
      'normalize',
    ]);
    const built = (from: string): string =>
      `import { BASELINE_CLASS } from '${from}'; const R = new RegExp(\`[\${BASELINE_CLASS.token}]\`, 'u');`;
    const table = (from: string): string =>
      `import { ASSIGNED } from '${from}'; const U = new RegExp(\`[^\${ASSIGNED}]\`, 'u');`;
    const rules = (file: string, text: string): string[] => findings(file, text).map(({ rule }) => rule);
    expect(rules('text/x.ts', built('../unicode-baseline'))).toEqual([]);
    expect(rules('text/x.ts', table('../unicode-table-assigned'))).toEqual([]);
    expect(rules('text/x.ts', built('./unicode-baseline'))).toEqual(['regexp-built']);
    expect(rules('text/x.ts', table('./unicode-table-assigned'))).toEqual(['regexp-built']);
    expect(rules('x.ts', built('../unicode-baseline'))).toEqual(['regexp-built']);
    expect(rules('x.ts', built('unicode-baseline'))).toEqual(['regexp-built']);
    expect(rules('x.ts', built('./unicode-baseline'))).toEqual([]);
    const local = `export const BASELINE_CLASS = { token: 'x' }; const R = new RegExp(\`[\${BASELINE_CLASS.token}]\`, 'u');`;
    expect(rules('text/unicode-baseline.ts', local)).toEqual(['regexp-built']);
  });
});
