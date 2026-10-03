/**
 * `pnpm exec tsx scripts/gen-unicode-baseline.ts [--check]` — writes the Unicode baseline tables that src/core
 * reads text by (docs/grading.md §11, Decisions.md [SEC-1]), from the Unicode Character Database 15.0.0 files
 * committed in scripts/ucd/15.0.0/ (downloaded from https://www.unicode.org/Public/15.0.0/ucd/, the
 * General_Category file from its extracted/ folder and the Word_Break file from auxiliary/). With `--check` it
 * writes nothing and exits 1 when a committed table differs from what the files generate.
 *
 * Why: grading must give the same answer on every engine, forever (Hard Rule 4). A JS engine's `\p{…}` classes,
 * `\s`, `trim()`, `normalize()` and `toLowerCase()` follow the Unicode version of the engine's ICU, and the
 * oldest Chrome Attest supports (minimum_chrome_version 120: ICU 73.1, Unicode 15.0) reads newer characters as
 * unassigned. So src/core reads every character property from these 15.0 tables, and hides each code point
 * 15.0 does not assign from the engine's normalisation and case mapping (src/core/unicode-baseline.ts).
 *
 * Each table is the body of a regular-expression character class for the `u` flag, every code point written
 * `\u{hex}` (never a surrogate-pair escape), split into short strings: src/core may hold no numeric literal.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const UNICODE_VERSION = '15.0.0';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UCD_DIR = `scripts/ucd/${UNICODE_VERSION}`;

/** The UCD files read, with the SHA-256 of the file unicode.org publishes (a changed file is refused). */
export const UCD_FILES = {
  'DerivedAge.txt': '7570877e0fa197c45338f7c41a02636da4e14c8dba6a3611a01cd30bf329d5ca',
  'DerivedGeneralCategory.txt': 'fe29a45c0882500e591140aaa5c4f5067e6a5d746806148af34400c48b9c06f9',
  'PropList.txt': 'e05c0a2811d113dae4abd832884199a3ea8d187ee1b872d8240a788a96540bfd',
  'WordBreakProperty.txt': '5188a56e91593467c2e912601ebc78750e6adc9b04541b8c5becb5441e388ce2',
} as const;
export type UcdFile = keyof typeof UCD_FILES;
export type UcdSources = Readonly<Record<UcdFile, string>>;

/** The generated modules, relative to the repo root. */
export const TABLE_FILES = {
  assigned: 'extension/src/core/unicode-table-assigned.ts',
  classes: 'extension/src/core/unicode-table-classes.ts',
  case: 'extension/src/core/unicode-table-case.ts',
} as const;
export type TableFile = keyof typeof TABLE_FILES;

const CODE_POINTS = 0x110000;
/** Longest string in a generated array, so each line stays inside Prettier's 110 columns. */
const CHUNK = 96;
/** The widest single-line `export const NAME = '…';` Prettier keeps on one line. */
const PRINT_WIDTH = 110;

/** One data line of a UCD file: a code point range and its property value. */
export interface UcdRow {
  readonly first: number;
  readonly last: number;
  readonly value: string;
}

/** The data lines of a UCD file (`0041..005A ; L # …`); comments and blank lines are skipped. */
export function parseUcd(text: string): UcdRow[] {
  const rows: UcdRow[] = [];
  for (const line of text.split('\n')) {
    const data = (line.split('#')[0] ?? '').trim();
    if (data === '') continue;
    const [range = '', value = ''] = data.split(';').map((field) => field.trim());
    const [first = '', last = first] = range.split('..');
    rows.push({ first: Number.parseInt(first, 16), last: Number.parseInt(last, 16), value });
  }
  return rows;
}

/** A set of code points, one byte per code point. */
type CodePointSet = Uint8Array;

function setOf(rows: readonly UcdRow[], keep: (value: string) => boolean): CodePointSet {
  const set = new Uint8Array(CODE_POINTS);
  for (const row of rows) if (keep(row.value)) set.fill(1, row.first, row.last + 1);
  return set;
}

function union(...sets: readonly CodePointSet[]): CodePointSet {
  const result = new Uint8Array(CODE_POINTS);
  for (const set of sets) for (let c = 0; c < CODE_POINTS; c += 1) if (set[c] === 1) result[c] = 1;
  return result;
}

function minus(set: CodePointSet, removed: CodePointSet): CodePointSet {
  return set.map((member, c) => (member === 1 && removed[c] !== 1 ? 1 : 0));
}

/** Maximal runs of members, as inclusive [first, last] pairs. */
export function rangesOf(set: CodePointSet): [number, number][] {
  const ranges: [number, number][] = [];
  for (let c = 0; c < CODE_POINTS; c += 1) {
    if (set[c] !== 1) continue;
    const last = ranges.at(-1);
    if (last?.[1] === c - 1) last[1] = c;
    else ranges.push([c, c]);
  }
  return ranges;
}

/** `\\u{HEX}` as it is written in the TS source, so the string holds the escape, not the character. */
const escape = (c: number): string => `\\\\u{${c.toString(16).toUpperCase()}}`;

/** The class body `\u{41}-\u{5A}\u{61}…`, as strings of at most CHUNK characters (a range is never split). */
export function classChunks(set: CodePointSet): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const [first, last] of rangesOf(set)) {
    const item = first === last ? escape(first) : `${escape(first)}-${escape(last)}`;
    if (chunk.length + item.length > CHUNK) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += item;
  }
  if (chunk !== '') chunks.push(chunk);
  return chunks;
}

export interface BaselineSets {
  readonly assigned: CodePointSet;
  readonly reservedIgnorable: CodePointSet;
  readonly letterOrDigit: CodePointSet;
  readonly mark: CodePointSet;
  readonly format: CodePointSet;
  readonly nonspacingMark: CodePointSet;
  readonly otherNumber: CodePointSet;
  readonly invisible: CodePointSet;
  readonly space: CodePointSet;
  readonly whiteSpace: CodePointSet;
  readonly cased: CodePointSet;
  readonly caseIgnorable: CodePointSet;
}

/** ECMAScript WhiteSpace and LineTerminator besides Zs: TAB, LF, VT, FF, CR, ZWNBSP, LS, PS. */
const ECMASCRIPT_SPACE: readonly number[] = [0x9, 0xa, 0xb, 0xc, 0xd, 0xfeff, 0x2028, 0x2029];

/**
 * Default_Ignorable_Code_Point as DerivedCoreProperties-15.0.0.txt derives it: Other_Default_Ignorable_Code_Point
 * + Cf + Variation_Selector − White_Space − FFF9..FFFB − 13430..13440 − Prepended_Concatenation_Mark.
 */
function defaultIgnorable(props: readonly UcdRow[], cf: CodePointSet): CodePointSet {
  const prop = (name: string) => setOf(props, (value) => value === name);
  const visible = setOf(
    [
      { first: 0xfff9, last: 0xfffb, value: '' },
      { first: 0x13430, last: 0x13440, value: '' },
    ],
    () => true,
  );
  const ignorable = union(prop('Other_Default_Ignorable_Code_Point'), cf, prop('Variation_Selector'));
  return minus(minus(minus(ignorable, prop('White_Space')), visible), prop('Prepended_Concatenation_Mark'));
}

/**
 * Cased and Case_Ignorable as DerivedCoreProperties-15.0.0.txt derives them (it states 4,526 and 2,707 code
 * points): Cased = Lowercase + Uppercase + Lt = Ll + Other_Lowercase + Lu + Other_Uppercase + Lt;
 * Case_Ignorable = Mn + Me + Cf + Lm + Sk + Word_Break MidLetter, MidNumLet or Single_Quote.
 */
function caseSets(categories: readonly UcdRow[], props: readonly UcdRow[], wordBreak: readonly UcdRow[]) {
  const otherCase = setOf(props, (value) => value === 'Other_Lowercase' || value === 'Other_Uppercase');
  const midWord = ['MidLetter', 'MidNumLet', 'Single_Quote'];
  return {
    cased: union(
      setOf(categories, (value) => ['Ll', 'Lu', 'Lt'].includes(value)),
      otherCase,
    ),
    caseIgnorable: union(
      setOf(categories, (value) => ['Mn', 'Me', 'Cf', 'Lm', 'Sk'].includes(value)),
      setOf(wordBreak, (value) => midWord.includes(value)),
    ),
  };
}

/** Every set the tables hold, from the four UCD files. */
export function baselineSets(sources: UcdSources): BaselineSets {
  const ages = parseUcd(sources['DerivedAge.txt']);
  const late = ages.find((row) => Number(row.value) > Number.parseFloat(UNICODE_VERSION));
  if (late !== undefined)
    throw new Error(`DerivedAge.txt assigns ${late.value} code points: not ${UNICODE_VERSION}`);
  const categories = parseUcd(sources['DerivedGeneralCategory.txt']);
  const props = parseUcd(sources['PropList.txt']);
  const category = (keep: (value: string) => boolean) => setOf(categories, keep);
  const assigned = setOf(ages, () => true);
  const cf = category((value) => value === 'Cf');
  const ignorable = defaultIgnorable(props, cf);
  const ecmaSpace = setOf(
    ECMASCRIPT_SPACE.map((c) => ({ first: c, last: c, value: '' })),
    () => true,
  );
  return {
    assigned,
    reservedIgnorable: minus(ignorable, assigned),
    letterOrDigit: category((value) => /^[LN]/.test(value)),
    mark: category((value) => value.startsWith('M')),
    format: cf,
    nonspacingMark: category((value) => value === 'Mn'),
    otherNumber: category((value) => value === 'No'),
    invisible: union(cf, ignorable),
    space: union(
      ecmaSpace,
      category((value) => value === 'Zs'),
    ),
    whiteSpace: setOf(props, (value) => value === 'White_Space'),
    ...caseSets(categories, props, parseUcd(sources['WordBreakProperty.txt'])),
  };
}

function count(set: CodePointSet): number {
  return set.reduce((total, member) => total + member, 0);
}

/** 288833 → "288,833" (no locale: the output must not depend on the machine). */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(?:\d{3})+$)/g, ',');
}

/** `/** doc *\/ export const NAME = …;` holding the class body of `set`. */
function constant(name: string, doc: string, set: CodePointSet): string {
  const chunks = classChunks(set);
  const summary = `${grouped(count(set))} code points, ${grouped(rangesOf(set).length)} ranges`;
  const head = `/** ${doc} (${summary}). */\nexport const ${name} =`;
  const single = `${head} '${chunks.join('')}';`;
  if (chunks.length <= 1 && (single.split('\n')[1] ?? '').length <= PRINT_WIDTH) return `${single}\n`;
  return `${head} [\n${chunks.map((chunk) => `  '${chunk}',`).join('\n')}\n].join('');\n`;
}

function header(sources: UcdSources, purpose: string): string {
  const hashes = (Object.keys(UCD_FILES) as UcdFile[]).map(
    (file) => ` *   ${file} ${createHash('sha256').update(sources[file]).digest('hex')}`,
  );
  return [
    '/**',
    ` * GENERATED by scripts/gen-unicode-baseline.ts from the Unicode Character Database ${UNICODE_VERSION}: do not edit.`,
    ' * Regenerate from the repo root with `pnpm exec tsx scripts/gen-unicode-baseline.ts` (`--check` verifies it).',
    ` * Sources (${UCD_DIR}/, from https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/), SHA-256:`,
    ...hashes,
    ` * ${purpose}`,
    ' * Each constant is a regular-expression character class body for the `u` flag (docs/grading.md §11).',
    ' */',
    '',
  ].join('\n');
}

function assignedModule(sources: UcdSources, sets: BaselineSets): string {
  return [
    header(
      sources,
      'What Unicode 15.0 assigns; unicode-baseline.ts hides every other code point from the engine.',
    ),
    '/** The Unicode version grading reads text by. */',
    `export const UNICODE_BASELINE_VERSION = '${UNICODE_VERSION}';\n`,
    constant(
      'ASSIGNED',
      'Assigned (DerivedAge: characters, noncharacters, surrogates, private use)',
      sets.assigned,
    ),
    constant(
      'RESERVED_IGNORABLE',
      'Unassigned but Default_Ignorable_Code_Point, so every engine already strips them',
      sets.reservedIgnorable,
    ),
  ].join('\n');
}

function classesModule(sources: UcdSources, sets: BaselineSets): string {
  return [
    header(sources, 'The character properties src/core reads, as Unicode 15.0 defines them.'),
    constant('LETTER_OR_DIGIT', 'Letters and digits: General_Category L or N', sets.letterOrDigit),
    constant('MARK', 'Marks: General_Category M (Mn, Mc, Me)', sets.mark),
    constant('NONSPACING_MARK', 'General_Category Mn', sets.nonspacingMark),
    constant('OTHER_NUMBER', 'General_Category No', sets.otherNumber),
    constant('FORMAT', 'General_Category Cf', sets.format),
    constant('INVISIBLE', 'General_Category Cf, and Default_Ignorable_Code_Point', sets.invisible),
    constant(
      'SPACE',
      'ECMAScript `\\s` and `trim()`: WhiteSpace (Zs, TAB, VT, FF, ZWNBSP) and LineTerminator',
      sets.space,
    ),
    constant('WHITE_SPACE', 'The White_Space property (adds U+0085, lacks U+FEFF)', sets.whiteSpace),
  ].join('\n');
}

function caseModule(sources: UcdSources, sets: BaselineSets): string {
  return [
    header(
      sources,
      "The case properties lowercasing's Final_Sigma context reads, as Unicode 15.0 defines them.",
    ),
    constant('CASED', 'Cased: Lowercase, Uppercase or General_Category Lt', sets.cased),
    constant(
      'CASE_IGNORABLE',
      'Case_Ignorable: Mn, Me, Cf, Lm, Sk and the mid-word punctuation',
      sets.caseIgnorable,
    ),
  ].join('\n');
}

/** The generated modules' text, keyed like TABLE_FILES. */
export function generateTables(sources: UcdSources): Record<TableFile, string> {
  const sets = baselineSets(sources);
  return {
    assigned: assignedModule(sources, sets),
    classes: classesModule(sources, sets),
    case: caseModule(sources, sets),
  };
}

/** The committed UCD files, each checked against its published SHA-256. */
export function readSources(root: string = REPO_ROOT): UcdSources {
  const read = (file: UcdFile): string => {
    const text = readFileSync(path.join(root, UCD_DIR, file), 'utf8');
    const digest = createHash('sha256').update(text).digest('hex');
    if (digest !== UCD_FILES[file])
      throw new Error(`${UCD_DIR}/${file}: SHA-256 ${digest} is not the UCD file`);
    return text;
  };
  return {
    'DerivedAge.txt': read('DerivedAge.txt'),
    'DerivedGeneralCategory.txt': read('DerivedGeneralCategory.txt'),
    'PropList.txt': read('PropList.txt'),
    'WordBreakProperty.txt': read('WordBreakProperty.txt'),
  };
}

/** Writes (or with `--check`, compares) the tables. Returns the exit code. */
export function runCli(argv: readonly string[], root: string = REPO_ROOT): number {
  const check = argv.includes('--check');
  const tables = generateTables(readSources(root));
  let stale = 0;
  for (const key of Object.keys(TABLE_FILES) as TableFile[]) {
    const file = path.join(root, TABLE_FILES[key]);
    if (!check) writeFileSync(file, tables[key]);
    else if (readFileSync(file, 'utf8') !== tables[key]) {
      stale += 1;
      process.stderr.write(`${TABLE_FILES[key]} is stale: run scripts/gen-unicode-baseline.ts\n`);
    }
  }
  return stale === 0 ? 0 : 1;
}

const invokedAs = process.argv[1];
if (invokedAs !== undefined && import.meta.url === pathToFileURL(path.resolve(invokedAs)).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
