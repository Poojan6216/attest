/**
 * Page text in a share, over any text (sprint_4 4.7, 4.8; src/ui/digest-share.ts `escapeMarkdown`, src/ui/receipt-share.ts,
 * src/ui/share-png.ts; agents/ux_engineer.md rule 11; Sprint 4 QA review, qa_tester priority 7: unicode in share
 * escaping). A subject hint and a domain come from a page or a pasted log, so a share must hold them as text only:
 *  - `escapeMarkdown` leaves no character markdown gives a meaning unescaped, and the image's unescape gives back the
 *    text exactly, whatever it holds: emoji, combining marks, right-to-left text, invisible marks, lone surrogates;
 *  - a receipt's share and a week's share keep their shape whatever the hints and counterparties say: the same lines,
 *    the same headings, page text never starting a line, and the image draws each hint as it was written.
 * 1,000 random cases each. Every value is invented.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Claim, Observation, Receipt } from '../../../src/core/schema';
import { withoutAddresses } from '../../../src/ledger/domain';
import { DigestRecord } from '../../../src/ledger/types';
import { digestMarkdown } from '../../../src/ui/digest-share';
import { escapeMarkdown } from '../../../src/ui/markdown';
import { receiptMarkdown } from '../../../src/ui/receipt-share';
import { shareLines } from '../../../src/ui/share-png';
import { makeClaim, makeObservation, makeReceipt, sha } from '../ledger/fixtures';

const RUNS = { numRuns: 1_000 };

/** Every character `escapeMarkdown` must escape. */
const SPECIAL_CHARS = [
  '\\',
  '`',
  '*',
  '_',
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  '#',
  '+',
  '-',
  '.',
  '!',
  '|',
  '<',
  '>',
  '~',
];
const SPECIAL = SPECIAL_CHARS.join('');
const TRICKY = [
  ...SPECIAL_CHARS,
  'a',
  ' ',
  '&',
  ':',
  '/',
  '=',
  '@',
  'é',
  'e\u0301',
  '😀',
  '👩🏽\u200d💻',
  '\u202e',
  '\u200b',
  '\u200f',
  'سارة',
  '\ud800',
  '\udc00',
  'Ｈ',
];

/** One line of any text: no control character and no line or paragraph separator, as the schemas hold page text. */
const oneLine = fc
  .oneof(
    fc.string({ unit: fc.constantFrom(...TRICKY), maxLength: 30 }),
    fc.string({ unit: 'binary', maxLength: 30 }),
    fc.string({ unit: 'grapheme', maxLength: 20 }),
  )
  .filter((text) => /^[^\p{Cc}\u2028\u2029]*$/u.test(text));

const unescape = (text: string): string => text.replace(/\\(.)/gsu, '$1');

/** Whether every SPECIAL character of `text` stands escaped. */
function allEscaped(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '\\') index += 1;
    else if (SPECIAL.includes(char)) return false;
  }
  return true;
}

describe('escapeMarkdown', () => {
  it('escapes every character markdown gives a meaning, and unescapes to the text exactly', () => {
    fc.assert(
      fc.property(oneLine, (text) => {
        const escaped = escapeMarkdown(text);
        expect(allEscaped(escaped)).toBe(true);
        expect(unescape(escaped)).toBe(text);
      }),
      RUNS,
    );
  });
});

/** A receipt of a claim with `hint` and `party`, and one piece of evidence with `evidenceHint`, as markdown. */
function receiptShare(hint: string, party: string, evidenceHint: string): string | null {
  const claim = Claim.safeParse(makeClaim({ subjectHint: hint, counterparty: party }));
  const observation = Observation.safeParse(
    makeObservation({
      subjectHint: evidenceHint,
      counterparty: `dana@${party.length % 2 === 0 ? 'a' : 'b'}.example`,
    }),
  );
  if (!claim.success || !observation.success) return null;
  const receipt = Receipt.parse(
    makeReceipt({ claimId: claim.data.id, observationIds: [observation.data.id] }),
  );
  return receiptMarkdown({ receipt, claim: claim.data, observations: [observation.data] });
}

describe('a receipt shared, whatever its page text', () => {
  it('keeps the shape of a plain share, starts no line with page text, and draws each hint as written', () => {
    const plain = receiptShare('Plain', 'Plain', 'Plain');
    if (plain === null) throw new Error('the plain share did not build');
    const plainLines = plain.split('\n');
    fc.assert(
      fc.property(oneLine, oneLine, oneLine, (hint, party, evidenceHint) => {
        const markdown = receiptShare(hint, party, evidenceHint);
        fc.pre(markdown !== null && hint !== '' && evidenceHint !== '');
        const lines = markdown.split('\n');
        expect(lines).toHaveLength(plainLines.length);
        lines.forEach((line, index) => {
          const kind = (text: string) => /^(?:#{1,2} |- |$)/u.exec(text)?.[0] ?? 'text';
          expect(kind(line)).toBe(kind(plainLines[index] ?? ''));
        });
        expect(lines[0]).toBe(plainLines[0]);
        // A hint is drawn as written, but for any address in it, which a share writes as its domain (SEC-1).
        const drawn = shareLines(markdown).map(({ text }) => text);
        expect(drawn.some((line) => line.includes(`“${withoutAddresses(hint)}”`))).toBe(true);
        expect(drawn.some((line) => line.includes(`“${withoutAddresses(evidenceHint)}”`))).toBe(true);
        expect(drawn.join('\n')).not.toContain('@');
      }),
      RUNS,
    );
  });
});

const ZERO = { VERIFIED: 0, PARTIAL: 0, NOT_FOUND: 0, UNASKED: 0, OVER_SCOPE: 0, UNVERIFIABLE: 0 };

/** A week with one notable receipt carrying `hint` and `domain`, as markdown; null when the schema refuses them. */
function weekShare(hint: string, domain: string): string | null {
  const digest = DigestRecord.safeParse({
    week: '2026-10-05',
    from: '2026-10-05T00:00:00.000-04:00',
    to: '2026-10-12T00:00:00.000-04:00',
    createdAt: '2026-10-12T09:00:00.000-04:00',
    agents: [{ agent: 'muse', grades: ZERO, checking: 0, marked: 0, checked: 0, verified: 0 }],
    notable: [
      {
        receiptId: '01JA0000000000000000000003',
        agent: 'muse',
        grade: 'UNASKED',
        type: 'email.sent',
        at: '2026-10-06T14:03:00-04:00',
        domain,
        subjectHint: hint,
      },
    ],
    notableCount: 1,
    gaps: [],
    health: [],
  });
  return digest.success ? digestMarkdown(digest.data) : null;
}

describe('a week shared, whatever its page text', () => {
  it('keeps the shape of a plain share, its item one line, and draws the hint as written', () => {
    const plain = weekShare('Plain', 'plain.example');
    if (plain === null) throw new Error('the plain share did not build');
    const plainLines = plain.split('\n');
    fc.assert(
      fc.property(oneLine, fc.domain(), (hint, domain) => {
        const markdown = weekShare(hint, domain.toLowerCase());
        fc.pre(markdown !== null && hint !== '');
        const lines = markdown.split('\n');
        expect(lines).toHaveLength(plainLines.length);
        expect(lines.filter((line) => line.startsWith('#'))).toEqual(
          plainLines.filter((line) => line.startsWith('#')),
        );
        const item = lines.find((line) => line.startsWith('- Unasked: likely Muse ('));
        expect(item).toBeDefined();
        expect(item?.endsWith(`“${escapeMarkdown(withoutAddresses(hint))}”)`)).toBe(true);
        expect(shareLines(markdown).some(({ text }) => text.endsWith(`“${withoutAddresses(hint)}”)`))).toBe(
          true,
        );
        expect(markdown).not.toContain('@');
      }),
      RUNS,
    );
  });
});

describe('the plain shares the properties compare with', () => {
  it('build, so no property passes over nothing', () => {
    expect(receiptShare('Q3 review', 'priya@company.example', 'Q3 review')).toContain('company\\.example');
    expect(weekShare('Q3 review', 'company.example')).toContain('“Q3 review”');
    expect(sha(1)).toHaveLength(64);
  });
});
