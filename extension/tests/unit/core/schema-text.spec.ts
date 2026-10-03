/**
 * SEC-3 (Hard Rule 2): the free-text facts of a claim and an observation (counterparty, merchant, subjectHint)
 * are one line. A control character (`\p{Cc}`: NUL, tab, CR, LF, ESC, DEL, U+0085), U+2028 or U+2029 anywhere
 * is refused at the field's own path, so a paragraph of mail cannot pass for an address or a name. Invisible
 * format marks, non-ASCII letters, astral code points and lone surrogates still parse: real vendor rows hold
 * them and §11 reads them.
 */
import { describe, expect, it } from 'vitest';

import { idFromHash } from '../../../src/core/hash';
import { Claim, Observation } from '../../../src/core/schema';
import { ONE_LINE, oneLineText } from '../../../src/core/schema-text';

const HASH = 'ef'.repeat(32);
const T = '2026-10-06T14:02:00-04:00';
const MESSAGE = 'must be one line with no control characters';

const CLAIM = {
  id: idFromHash(HASH),
  agent: 'muse',
  type: 'email.sent',
  claimedAt: T,
  claimedAtPrecision: 'minute',
  observedAt: T,
  sourceKind: 'chat',
  extractor: { id: 'muse', version: '1', confidence: 1 },
  rawHash: HASH,
};
const OBSERVATION = {
  id: idFromHash(HASH),
  source: 'gmail.sent',
  type: 'email.sent',
  occurredAt: T,
  observedAt: T,
  contentHash: HASH,
};

/** SECURITY review probe D: a message body passed off as a counterparty. */
const PROBE_D = 'Hi Priya,\nthe door code is 4417 and my SSN is 078-05-1120. Thanks';

/** Every line break and a sample of other control characters. */
const BREAKS: readonly (readonly [string, string])[] = [
  ['LF', '\n'],
  ['CR', '\r'],
  ['CRLF', '\r\n'],
  ['VT', '\v'],
  ['FF', '\f'],
  ['NEL U+0085', '\u0085'],
  ['LINE SEPARATOR U+2028', '\u2028'],
  ['PARAGRAPH SEPARATOR U+2029', '\u2029'],
  ['TAB', '\t'],
  ['NUL', '\u0000'],
  ['ESC', '\u001B'],
  ['DEL', '\u007F'],
  ['C1 CSI U+009B', '\u009B'],
];

/** One line, however unusual: these must keep parsing. */
const ONE_LINERS: readonly (readonly [string, string])[] = [
  ['empty', ''],
  ['an address', 'priya@company.com'],
  ['a display-name form', '"Priya Kumar" <priya@company.com>'],
  ['spaces around', '  Acme Books  '],
  ['non-ASCII letters', 'Jos\u00E9 \u0130stanbul \u212Aate'],
  ['an astral code point', 'Q3 \u{1F600}'],
  ['a lone surrogate', 'row \uD800'],
  ['zero-width and bidi marks (§11 strips them)', 'pri\u200Bya \u200E\u202Ekced'],
  ['a no-break space', 'Acme\u00A0Books'],
];

type Schema = typeof Claim | typeof Observation;
const FIELDS: readonly (readonly [string, Schema, Record<string, unknown>, string])[] = [
  ['Claim', Claim, CLAIM, 'counterparty'],
  ['Claim', Claim, CLAIM, 'subjectHint'],
  ['Observation', Observation, OBSERVATION, 'counterparty'],
  ['Observation', Observation, OBSERVATION, 'merchant'],
  ['Observation', Observation, OBSERVATION, 'subjectHint'],
];

function issuesAt(schema: Schema, base: Record<string, unknown>, field: string, text: string) {
  const result = schema.safeParse({ ...base, [field]: text });
  return result.success ? [] : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

describe.each(FIELDS)('%s.%s is one line', (_name, schema, base, field) => {
  it.each(BREAKS)('refuses %s at the start, middle or end, at the field path', (_label, mark) => {
    for (const text of [`${mark}x`, `a${mark}b`, `x${mark}`, mark]) {
      expect(issuesAt(schema, base, field, text)).toStrictEqual([[field, MESSAGE]]);
    }
  });

  it.each(ONE_LINERS)('accepts %s', (_label, text) => {
    expect(issuesAt(schema, base, field, text)).toStrictEqual([]);
  });

  it('refuses the probe-D message body, which only the old length cap would have allowed', () => {
    expect(issuesAt(schema, base, field, PROBE_D.slice(0, 40))).toStrictEqual([[field, MESSAGE]]);
  });
});

describe('ONE_LINE and oneLineText', () => {
  it('ONE_LINE refuses exactly \\p{Cc}, U+2028 and U+2029 among the first 0x3000 code points', () => {
    const refused: number[] = [];
    for (let code = 0; code < 0x3000; code += 1) {
      if (!ONE_LINE.test(String.fromCodePoint(code))) refused.push(code);
    }
    const controls = [
      ...Array.from({ length: 0x20 }, (_, i) => i),
      ...Array.from({ length: 0x21 }, (_, i) => 0x7f + i),
    ];
    expect(refused).toStrictEqual([...controls, 0x2028, 0x2029]);
  });

  it('oneLineText keeps its cap in code points and its one-line rule together', () => {
    const schema = oneLineText(3);
    expect(schema.safeParse('ab\u{1F600}').success).toBe(true);
    expect(schema.safeParse('abcd').success).toBe(false);
    expect(schema.safeParse('a\nb').success).toBe(false);
  });
});
