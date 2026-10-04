/**
 * SEC-1 (Hard Rule 4): the Unicode 15.0 tables src/core reads text by (unicode-table-assigned.ts,
 * unicode-table-classes.ts) are exactly what scripts/gen-unicode-baseline.ts generates from the committed UCD
 * 15.0.0 files, those files are the published ones, and the assigned set has the size Unicode 15.0 publishes.
 * The engine checks at the end tell us when the engine running the suite stops agreeing with 15.0 on a 15.0
 * character: the readers do not depend on that (they read the tables), but the residual limits in Decisions
 * [SEC-1] (normalisation and lowercase of 15.0 characters stay the engine's) do.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  generateTables,
  readSources,
  TABLE_FILES,
  UCD_DIR,
  UCD_FILES,
  type UcdFile,
} from '../../../../scripts/gen-unicode-baseline';
import { BASELINE_CLASS, UNICODE_BASELINE_VERSION } from '../../../src/core/unicode-baseline';
import { ASSIGNED, RESERVED_IGNORABLE } from '../../../src/core/unicode-table-assigned';
import { MARK } from '../../../src/core/unicode-table-classes';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CODE_POINTS = 0x110000;
const SURROGATES = { first: 0xd800, last: 0xdfff };

/** Every code point in the class body `body`, by testing each one: what the engine compiles, not the text. */
function members(body: string): number[] {
  const one = new RegExp(`^[${body}]$`, 'u');
  const found: number[] = [];
  for (let c = 0; c < CODE_POINTS; c += 1) if (one.test(String.fromCodePoint(c))) found.push(c);
  return found;
}

const ASSIGNED_CODE_POINTS = members(ASSIGNED);
const ASSIGNED_SET: ReadonlySet<number> = new Set(ASSIGNED_CODE_POINTS);
/** The 15.0 characters a JS string can hold on its own (a lone surrogate is a code unit, not a character). */
const CHARACTERS = ASSIGNED_CODE_POINTS.filter((c) => c < SURROGATES.first || c > SURROGATES.last);

describe('the generated Unicode 15.0 tables', () => {
  it('come from the published UCD 15.0.0 files, unmodified', () => {
    expect(UNICODE_BASELINE_VERSION).toBe('15.0.0');
    for (const file of Object.keys(UCD_FILES) as UcdFile[]) {
      const text = readFileSync(path.join(REPO_ROOT, UCD_DIR, file), 'utf8');
      expect(text.startsWith(`# ${file.replace('.txt', '')}-15.0.0.txt`)).toBe(true);
      expect(createHash('sha256').update(text).digest('hex')).toBe(UCD_FILES[file]);
    }
  });

  it('are exactly what the generator writes from those files (no hand edits, nothing stale)', () => {
    const tables = generateTables(readSources(REPO_ROOT));
    for (const key of Object.keys(TABLE_FILES) as (keyof typeof TABLE_FILES)[]) {
      expect(readFileSync(path.join(REPO_ROOT, TABLE_FILES[key]), 'utf8')).toBe(tables[key]);
    }
  });

  it('assign the 288,833 code points DerivedAge-15.0.0.txt totals, the count Unicode 15.0 publishes', () => {
    const derivedAge = readFileSync(path.join(REPO_ROOT, UCD_DIR, 'DerivedAge.txt'), 'utf8');
    const totals = [...derivedAge.matchAll(/^# Total code points: (\d+)$/gm)].map((match) =>
      Number(match[1]),
    );
    const total = totals.reduce((sum, value) => sum + value, 0);
    // 149,186 graphic and format characters, 65 controls, 137,468 private use, 2,048 surrogates, 66 noncharacters.
    expect(total).toBe(149_186 + 65 + 137_468 + 2_048 + 66);
    expect(ASSIGNED_CODE_POINTS.length).toBe(total);
  });
});

describe('the generated Unicode 15.0 tables, class by class', () => {
  it('leave unassigned exactly what 15.0 leaves unassigned around the newest characters', () => {
    // Kawi (15.0) is assigned; CJK Ext I (15.1), Garay and the outlined digits (16.0) are not.
    expect([0x11f00, 0x31350, 0x1f6dc].every((c) => ASSIGNED_SET.has(c))).toBe(true);
    expect([0x2ebf0, 0x10d50, 0x1ccf0, 0x1ccf9, 0x1fae9, 0x0378].some((c) => ASSIGNED_SET.has(c))).toBe(
      false,
    );
    expect([0xfdd0, 0x1fffe, 0xe000, 0x10fffd, SURROGATES.first].every((c) => ASSIGNED_SET.has(c))).toBe(
      true,
    );
  });

  it('make the reserved default-ignorable ranges, and nothing else unassigned, ignorable', () => {
    const ranges = [
      [0x2065, 0x2065],
      [0xfff0, 0xfff8],
      [0xe0000, 0xe0000],
      [0xe0002, 0xe001f],
      [0xe0080, 0xe00ff],
      [0xe01f0, 0xe0fff],
    ];
    const expected = ranges.flatMap(([first = 0, last = 0]) =>
      Array.from({ length: last - first + 1 }, (_, i) => first + i),
    );
    expect(members(RESERVED_IGNORABLE)).toEqual(expected);
    expect(members(BASELINE_CLASS.invisible).filter((c) => !ASSIGNED_SET.has(c))).toEqual(expected);
  });

  it('hold, class by class, the counts the 15.0.0 files state (read from their comments, not parsed)', () => {
    const totals = categoryTotals();
    const sum = (...names: string[]) => names.reduce((total, key) => total + (totals.get(key) ?? NaN), 0);
    const letters = ['Uppercase', 'Lowercase', 'Titlecase', 'Modifier', 'Other'].map((k) => `${k}_Letter`);
    const numbers = ['Decimal_Number', 'Letter_Number', 'Other_Number'];
    const marks = ['Nonspacing_Mark', 'Spacing_Mark', 'Enclosing_Mark'];
    // Cn counts the 66 noncharacters, which DerivedAge assigns.
    expect(ASSIGNED_CODE_POINTS.length).toBe(CODE_POINTS - sum('Unassigned') + 66);
    expect(members(BASELINE_CLASS.letterOrDigit).length).toBe(sum(...letters, ...numbers));
    expect(members(MARK).length).toBe(sum(...marks));
    expect(members(BASELINE_CLASS.token).length).toBe(sum(...letters, ...numbers, ...marks));
    expect(members(BASELINE_CLASS.nonspacingMark).length).toBe(sum('Nonspacing_Mark'));
    expect(members(BASELINE_CLASS.otherNumber).length).toBe(sum('Other_Number'));
    expect(members(BASELINE_CLASS.format).length).toBe(sum('Format'));
    // The totals DerivedCoreProperties-15.0.0.txt states (that file is not committed: the generator derives both).
    expect(members(BASELINE_CLASS.cased).length).toBe(4_526);
    expect(members(BASELINE_CLASS.caseIgnorable).length).toBe(2_707);
    // PropList's first property is White_Space: its data lines, then its total.
    const propList = readFileSync(path.join(REPO_ROOT, UCD_DIR, 'PropList.txt'), 'utf8');
    const [lines = '', whiteSpace] = propList.split(/^# Total code points: (\d+)$/m);
    expect(lines.match(/^[\dA-F.]+ +; \w+/gm)?.every((line) => line.endsWith('White_Space'))).toBe(true);
    expect(members(BASELINE_CLASS.whiteSpace).length).toBe(Number(whiteSpace));
  });
});

/** `General_Category=Name` → the "# Total code points" DerivedGeneralCategory-15.0.0.txt states for it. */
function categoryTotals(): ReadonlyMap<string, number> {
  const text = readFileSync(path.join(REPO_ROOT, UCD_DIR, 'DerivedGeneralCategory.txt'), 'utf8');
  const sections = text.matchAll(/^# General_Category=(\w+)$[\s\S]*?^# Total code points: (\d+)$/gm);
  return new Map([...sections].map((match): [string, number] => [match[1] ?? '', Number(match[2])]));
}

/**
 * Where the engine running the suite disagrees with Unicode 15.0 about a 15.0 character, by class, keyed by the
 * engine's own Unicode version (`process.versions.unicode`). Node 22.14 (ICU 76, Unicode 16.0) moved U+1171E AHOM
 * CONSONANT SIGN MEDIAL RA from Mn to Mc, so it is no longer Case_Ignorable either. Node 22.23 (ICU 78, Unicode 17.0)
 * also drops U+0295 LATIN LETTER PHARYNGEAL VOICED FRICATIVE from Cased. The readers decide casing and final sigma
 * from the 15.0 tables, so neither changes a grade (every reader, property and golden test passes on both engines).
 * An engine version not listed, or a new disagreement, fails here: it must be reviewed and listed in Decisions
 * [SEC-1] before it is added.
 */
type Drift = Readonly<Record<keyof typeof BASELINE_CLASS, readonly number[]>>;
const UNICODE_16_DRIFT: Drift = {
  token: [],
  letterOrDigit: [],
  nonspacingMark: [0x1171e],
  otherNumber: [],
  format: [],
  invisible: [],
  space: [],
  whiteSpace: [],
  cased: [],
  caseIgnorable: [0x1171e],
};
const KNOWN_ENGINE_DRIFT: Readonly<Record<string, Drift>> = {
  '16.0': UNICODE_16_DRIFT,
  '17.0': { ...UNICODE_16_DRIFT, cased: [0x295] },
};
const ENGINE_UNICODE = process.versions.unicode ?? 'unknown';
const ENGINE_CLASS: Readonly<Record<keyof typeof BASELINE_CLASS, RegExp>> = {
  token: /^[\p{L}\p{N}\p{M}]$/u,
  letterOrDigit: /^[\p{L}\p{N}]$/u,
  nonspacingMark: /^\p{Mn}$/u,
  otherNumber: /^\p{No}$/u,
  format: /^\p{Cf}$/u,
  invisible: /^[\p{Cf}\p{Default_Ignorable_Code_Point}]$/u,
  space: /^\s$/u,
  whiteSpace: /^\p{White_Space}$/u,
  cased: /^\p{Cased}$/u,
  caseIgnorable: /^\p{Case_Ignorable}$/u,
};

describe('the engine running the suite, on Unicode 15.0 characters', () => {
  it.each(Object.keys(BASELINE_CLASS) as (keyof typeof BASELINE_CLASS)[])(
    'agrees with the 15.0 %s class but for the listed drift',
    (key) => {
      const table = new RegExp(`^[${BASELINE_CLASS[key]}]$`, 'u');
      const drift = CHARACTERS.filter((c) => {
        const character = String.fromCodePoint(c);
        return table.test(character) !== ENGINE_CLASS[key].test(character);
      });
      const known = KNOWN_ENGINE_DRIFT[ENGINE_UNICODE];
      expect(known, `engine Unicode ${ENGINE_UNICODE}: review its drift and list it`).toBeDefined();
      expect(drift).toEqual(known?.[key]);
    },
  );

  it('normalises and lowercases every 15.0 character into 15.0 characters only', () => {
    const outside = (text: string) => Array.from(text).some((c) => !ASSIGNED_SET.has(c.codePointAt(0) ?? -1));
    const escaped: string[] = [];
    for (const c of CHARACTERS) {
      const character = String.fromCodePoint(c);
      const forms = ['NFC', 'NFD', 'NFKC', 'NFKD'].map((form) => character.normalize(form));
      if ([...forms, character.toLowerCase()].some(outside)) escaped.push(c.toString(16));
    }
    expect(escaped).toEqual([]);
  });
});
