/**
 * SEC-1 (Hard Rule 4, Hard Rule 5): a lone surrogate (half of a UTF-16 pair with no partner) reads as the U+FFFD it
 * displays as, whatever is removed around it. Two halves with an invisible or nonspacing mark between them must
 * never pair once the mark is removed: "\uD833\u200B\uDCF1" would become U+1CCF1 (OUTLINED DIGIT ONE, Unicode
 * 16.0), which NFKC turns into "1" on Node 22 and Chrome 153 and leaves alone on Chromium 123, so the same claim
 * graded VERIFIED on one engine and PARTIAL on another under the same inputsHash and receipt id. Halves of a 15.0
 * character would let text read as a digit or letter it never displays ("\uD835\u200B\uDFCF" as bold "1").
 * Every non-ASCII input is a \u escape (Decisions [1.1]).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { buildClaim } from '../../golden/build';
import { merchantName, prepareMerchant } from '../../../src/core/features-content';
import { grade } from '../../../src/core/grade';
import {
  amount,
  counterparty,
  name,
  nameTokens,
  resolveRelative,
  stopWordKey,
  subjectTokens,
} from '../../../src/core/normalize';
import { loadPolicy } from '../../../src/core/policy';
import { hashText, project } from '../../../src/core/redact';
import { Coverage, Grant, type Receipt } from '../../../src/core/schema';
import { asBaseline, onBaseline } from '../../../src/core/unicode-baseline';

/** What a reader may remove: format and default-ignorable marks (every reader), a nonspacing mark (names). */
const INVISIBLE_MARKS = ['\u200B', '\u00AD', '\uFEFF', '\u2066', '\u{E0080}', '\u034F'];
const MARKS = [...INVISIBLE_MARKS, '\u0301'];
/** The two halves of `character` with `mark` between them. */
const split = (character: string, mark: string): string =>
  `${character.charAt(0)}${mark}${character.charAt(1)}`;
const OUTLINED_ONE = '\u{1CCF1}'; // Unicode 16.0, NFKC "1" on Node 22
const BOLD_ONE = '\u{1D7CF}'; // MATHEMATICAL BOLD DIGIT ONE, Unicode 15.0 (Nd, NFKC "1")
const BOLD_P = '\u{1D429}'; // MATHEMATICAL BOLD SMALL P, Unicode 15.0 (NFKC "p")
const DIGIT_ONE_COMMA = '\u{1F102}'; // Unicode 15.0 No: NFKC "1,", so readsDifferently
const REPLACED = '\uFFFD\uFFFD';
const CONTEXT = { referenceIso: '2026-10-06T14:00:00-04:00', offsetAt: () => -240 };
const USD = { defaultDollar: 'USD' } as const;

describe('two lone surrogates around a removed mark never pair', () => {
  it('a name reads them as two U+FFFD, never as the outlined digit they would pair into', () => {
    for (const mark of MARKS) {
      const text = `Priya ${split(OUTLINED_ONE, mark)}`;
      expect([mark, name(text), nameTokens(text)]).toEqual([mark, `priya ${REPLACED}`, ['priya']]);
      expect([mark, counterparty(text)]).toEqual([mark, { kind: 'name', tokens: ['priya'] }]);
      const merchant = `Acme ${split(OUTLINED_ONE, mark)}`;
      expect([mark, merchantName(merchant)]).toEqual([mark, { name: `acme ${REPLACED}`, tokens: ['acme'] }]);
      expect([mark, prepareMerchant(merchant)]).toEqual([mark, { tokens: new Set(['acme']) }]);
    }
  });

  it('subject tokens, an amount, a time and a stop word read them as two U+FFFD', () => {
    for (const mark of INVISIBLE_MARKS) {
      expect([mark, subjectTokens(`Q3 report ${split(OUTLINED_ONE, mark)}`, [])]).toEqual([
        mark,
        ['q3', 'report'],
      ]);
      expect([mark, subjectTokens(`Q3 re${split(BOLD_P, mark)}ort`, [])]).toEqual([
        mark,
        ['ort', 'q3', 're'],
      ]);
      expect([
        mark,
        amount(`$1${split(OUTLINED_ONE, mark)}`, USD),
        amount(`$${split(BOLD_ONE, mark)}`, USD),
      ]).toEqual([mark, null, null]);
      expect([mark, resolveRelative(`${split(BOLD_ONE, mark)} min ago`, CONTEXT)]).toEqual([mark, null]);
      expect([mark, stopWordKey(`Q${split(BOLD_P, mark)}`)]).toEqual([mark, `q\uFFFD${mark}\uFFFD`]);
    }
  });

  it('a superscript-like digit split by a mark is not read as a digit (no readsDifferently bypass)', () => {
    expect(counterparty(`Priya ${DIGIT_ONE_COMMA}`)).toBeNull();
    for (const mark of MARKS) {
      const text = `Priya ${split(DIGIT_ONE_COMMA, mark)}`;
      expect([mark, counterparty(text), name(text)]).toEqual([
        mark,
        { kind: 'name', tokens: ['priya'] },
        `priya ${REPLACED}`,
      ]);
    }
  });
});

describe('asBaseline and onBaseline on lone surrogates', () => {
  it('asBaseline swaps a lone half for U+FFFD and a pair outside 15.0 for one noncharacter', () => {
    expect(asBaseline('\uD833\u200B\uDCF1')).toBe('\uFFFD\u200B\uFFFD');
    expect(asBaseline(`a${OUTLINED_ONE}b`)).toBe('a\u{1FFFE}b');
    expect(asBaseline('a\uDCF1\uD833b')).toBe('a\uFFFD\uFFFDb'); // low then high: no pair
    expect(asBaseline(`\uD833${BOLD_P}\uDCF1`)).toBe(`\uFFFD${BOLD_P}\uFFFD`);
    expect(onBaseline('\uD833', (text) => text)).toBe('\uFFFD');
  });

  it('onBaseline puts each held code point back in order: two halves never pair into a new hole', () => {
    // "\uD83F" and "\uDFFE" pair into U+1FFFE, the astral hole: paired, it would take the outlined digit's place.
    expect(name(`${split('\u{1FFFE}', '\u200B')} x ${OUTLINED_ONE}`)).toBe(`${REPLACED} x ${OUTLINED_ONE}`);
    const held = `\uFDD0 ${OUTLINED_ONE} \u{1FFFE}`; // a hole character already in the text is held too
    expect(name(`${split('\u{1FFFE}', '\u200B')} ${held}`)).toBe(`${REPLACED} ${held}`);
  });
});

const EVALUATED_AT = '2026-10-06T15:00:00-04:00';
const ACCOUNT = hashText('a@b.example');
const GRANT = Grant.parse({
  agent: 'muse',
  allowedTypes: ['email.sent'],
  counterpartyAllowlist: [],
  spendCeilingCents: null,
  declaredScopes: [],
  accounts: { 'gmail.sent': [ACCOUNT] },
  updatedAt: '2026-10-01T00:00:00-04:00',
});
const COVERAGE = Coverage.parse({
  evaluatedAt: EVALUATED_AT,
  observers: [
    {
      observerId: 'gmail.sent',
      source: 'gmail.sent',
      lastSyncAt: '2026-10-06T14:55:00-04:00',
      windowStart: '2026-10-06T09:00:00-04:00',
      windowEnd: '2026-10-06T14:55:00-04:00',
      accountHash: ACCOUNT,
    },
  ],
});

/** The receipt's grade, state and signals for an email.sent claim to `party`, sent to priya@company.com. */
function gradeOf(party: string): Pick<Receipt, 'grade' | 'state' | 'signals'> {
  const policy = loadPolicy(defaultPolicyJson);
  const claim = buildClaim({
    ref: 'c1',
    agent: 'muse',
    type: 'email.sent',
    counterparty: party,
    subjectHint: 'Q3 report',
    claimedAt: '2026-10-06T14:02:00-04:00',
  });
  const sent = project(
    'gmail.sent',
    { counterparty: 'priya@company.com', subjectHint: 'Q3 report', occurredAt: '2026-10-06T14:03:00-04:00' },
    { type: 'email.sent', observedAt: '2026-10-06T14:50:00-04:00' },
    policy,
  );
  const {
    grade: graded,
    state,
    signals,
  } = grade(claim, [sent], GRANT, policy, COVERAGE, {
    priorSpendCents: 0,
  });
  return { grade: graded, state, signals };
}

describe('a claim whose counterparty holds split halves grades as on a Unicode 15.0 engine', () => {
  it('grades VERIFIED like "Priya" (Chromium 123 gave VERIFIED, Node 22 PARTIAL before the fix)', () => {
    const plain = gradeOf('Priya');
    expect(plain).toMatchObject({ grade: 'VERIFIED', state: 'FINAL', signals: { score: 1 } });
    for (const mark of INVISIBLE_MARKS)
      expect([mark, gradeOf(`Priya ${split(OUTLINED_ONE, mark)}`)]).toEqual([mark, plain]);
  });
});
