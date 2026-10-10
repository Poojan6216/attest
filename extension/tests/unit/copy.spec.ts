// @vitest-environment happy-dom
/**
 * The copy pass (sprint_4 4.10 done-when: "a copy test greps all UI strings for banned words and the presence of
 * 'Likely agent' on UNASKED rows"; agents/ux_engineer.md copy rules: short, no exclamation marks, no "AI magic", grades
 * are nouns, buttons are verbs, the product never blames the user).
 *
 * Every string a person can read in the shipped UI (./copy/visible-strings.ts walks the source) holds no exclamation
 * mark and none of the banned words, and no grade as its code. Every button's label starts with a verb. An UNASKED
 * receipt says "Likely agent" in every row that shows it (the popup's day, the side panel's timeline and its detail,
 * the weekly digest), and "likely" in its alert and its shares (Hard Rule 7); no other grade says "likely". The scan is
 * proven to catch each kind of fault on a planted source, and to pass a class list's important mark.
 */
import { type ComponentChild, h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotableItem } from '../../entrypoints/digest/components/NotableItem';
import { Claim, IsoTs, NotableReceipt, Observation, Receipt } from '../../src/ledger/types';
import type { DigestRecord } from '../../src/ledger/types';
import { alertText } from '../../src/ui/alert-text';
import { digestMarkdown } from '../../src/ui/digest-share';
import { receiptMarkdown } from '../../src/ui/receipt-share';
import { ReceiptRow } from '../../src/ui/ReceiptRow';
import {
  type ButtonLabel,
  buttonLabels,
  buttonLabelsOf,
  type VisibleString,
  visibleStrings,
  visibleStringsOf,
} from './copy/visible-strings';
import { makeClaim, makeObservation, makeReceipt, omit, ulid } from './ledger/fixtures';

/** What no string a person reads may hold, each with why (ux_engineer copy rules; Hard Rules 5, 7). */
const BANNED: readonly (readonly [string, RegExp])[] = [
  ['an exclamation mark', /!/u],
  [
    'hype',
    /\b(?:magic(?:al)?|AI[- ]powered|powered by AI|revolutionary|seamless(?:ly)?|effortless(?:ly)?|cutting[- ]edge)\b/iu,
  ],
  [
    'false cheer',
    /\b(?:awesome|amazing|oops|whoops|uh[- ]oh|yay|woo-?hoo|hooray|great job|congrat(?:s|ulations))\b/iu,
  ],
  [
    'an "all clear"',
    /\b(?:all clear|all good|all set|nothing to worry|nothing to look at|everything is fine|everything looks good)\b/iu,
  ],
  [
    'blame',
    /\b(?:your fault|you forgot|you failed|you broke|you messed|you should have|user error|invalid input)\b/iu,
  ],
  ['certainty Attest does not have', /\b(?:definitely|certainly|guaranteed|without (?:a )?doubt)\b/iu],
  ['an apology', /\bsorry\b/iu],
  ['a grade as its code', /\b(?:NOT_FOUND|OVER_SCOPE|USER_OVERRIDDEN)\b/u],
];

/** The verbs a button's label may start with (a busy button's "-ing" form counts). Add one only for a new action. */
const VERBS: ReadonlySet<string> = new Set([
  'Add',
  'Cancel',
  'Copy',
  'Delete',
  'Edit',
  'Export',
  'Import',
  'Open',
  'Preview',
  'Reset',
  'Return',
  'Save',
  'Share',
  'Show',
  'Turn',
  'Undo',
  'Download',
  'Forget',
  'Score',
  'Check',
  'Record',
]);

/** Each banned word or mark in `strings`, as `file:line: why: "text"`. */
function copyProblems(strings: readonly VisibleString[]): string[] {
  return strings.flatMap(({ file, line, text }) =>
    BANNED.filter(([, pattern]) => pattern.test(text)).map(
      ([why]) => `${file}:${String(line)}: ${why}: "${text}"`,
    ),
  );
}

/** Whether `word` is one of VERBS, or a busy form of one ("Importing", "Deleting"). */
function isVerb(word: string): boolean {
  if (VERBS.has(word)) return true;
  const stem = word.replace(/ing$/u, '');
  return stem !== word && (VERBS.has(stem) || VERBS.has(`${stem}e`));
}

/**
 * Each button label that does not start with a verb, as `file:line: "label"`. A label that is only a value (the shared
 * Button's own children) is checked where the Button is used.
 */
function buttonProblems(labels: readonly ButtonLabel[]): string[] {
  return labels
    .filter(({ text }) => text !== '{…}' && !isVerb(text.split(/[\s…:]/u)[0] ?? ''))
    .map(({ file, line, text }) => `${file}:${String(line)}: "${text}"`);
}

describe('every string a person reads in the shipped UI', () => {
  const strings = visibleStrings();

  it('is found: the scan reads the pages, the shared components and the reasons', () => {
    expect(strings.length).toBeGreaterThan(500);
    const texts = new Set(strings.map(({ text }) => text));
    for (const known of [
      'Nothing leaves your browser.',
      'Likely agent: {…}',
      'Turn on checking Gmail',
      'Copy image',
    ]) {
      expect(texts).toContain(known);
    }
    expect(new Set(strings.map(({ file }) => file.split('/')[0]))).toEqual(new Set(['entrypoints', 'src']));
  });

  it('holds no exclamation mark, no hype, no false cheer, no "all clear", no blame, no apology and no grade code', () => {
    expect(copyProblems(strings)).toEqual([]);
  });

  it('labels every button with a verb', () => {
    const labels = buttonLabels();
    expect(labels.length).toBeGreaterThan(30);
    expect(buttonProblems(labels)).toEqual([]);
  });
});

describe('the scan, on a planted source', () => {
  const PLANTED = [
    "import { Button } from '../ui/Button';",
    "const STATUS = { done: 'Great job!', error: 'Oops, you forgot the date.' };",
    "const ROW_CLASSES = 'focus-visible:outline-neutral-900! bg-white';",
    'export function Planted({ on }: { on: boolean }) {',
    '  return (',
    '    <div class="p-2 hover:bg-red-50!" title="AI magic, guaranteed">',
    '      <p>{on ? "All clear" : "Checking"}</p>',
    '      <Button onClick={() => undefined}>Settings</Button>',
    '      <Button onClick={() => undefined}>{on ? "Turn off" : "Weekly digest"}</Button>',
    '      <p>{grade === "NOT_FOUND" ? `Grade: NOT_FOUND` : "Fine"}</p>',
    '    </div>',
    '  );',
    '}',
  ].join('\n');

  it('catches each kind of fault, and passes class lists and comparisons', () => {
    const found = visibleStringsOf('entrypoints/planted/Planted.tsx', PLANTED);
    expect(copyProblems(found).map((problem) => problem.replace(/^[^:]+:\d+: /u, ''))).toEqual([
      'an exclamation mark: "Great job!"',
      'false cheer: "Great job!"',
      'false cheer: "Oops, you forgot the date."',
      'blame: "Oops, you forgot the date."',
      'hype: "AI magic, guaranteed"',
      'certainty Attest does not have: "AI magic, guaranteed"',
      'an "all clear": "All clear"',
      'a grade as its code: "Grade: NOT_FOUND"',
    ]);
    expect(
      buttonProblems(buttonLabelsOf('entrypoints/planted/Planted.tsx', PLANTED)).map((p) =>
        p.replace(/^[^:]+:\d+: /u, ''),
      ),
    ).toEqual(['"Settings"', '"Weekly digest"']);
  });
});

const NOW = new Date(2026, 9, 9, 12, 0);
const iso = (ms: number) => IsoTs.parse(new Date(ms).toISOString());

/** A FINAL UNASKED receipt of Muse's, about an email no claim reported, and the observation it is about. */
function unasked(): { receipt: Receipt; orphan: Observation } {
  const receipt = Receipt.parse({
    ...omit(
      makeReceipt({ id: ulid(3), grade: 'UNASKED', computedAt: iso(NOW.getTime() - 60_000) }),
      'claimId',
    ),
    attribution: 'likely',
    state: 'FINAL',
    finalAt: iso(NOW.getTime() - 60_000),
    reasons: [{ code: 'unasked.session', params: { agent: 'muse' } }],
  });
  return {
    receipt,
    orphan: Observation.parse(makeObservation({ occurredAt: iso(NOW.getTime() - 3_600_000) })),
  };
}

const verified = (): Receipt =>
  Receipt.parse(makeReceipt({ id: ulid(4), computedAt: iso(NOW.getTime() - 60_000) }));

describe('an UNASKED receipt says "Likely agent" in every row, and no other grade says "likely"', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('ul');
    document.body.append(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  const rowText = (node: ComponentChild): string => {
    render(node, root);
    return root.textContent;
  };

  it.each([
    ['the popup’s day and the detail (no Details control)', undefined],
    ['the side panel’s timeline', () => undefined],
  ])('in %s', (_where, onOpen) => {
    const { receipt, orphan } = unasked();
    const props = { nowMs: NOW.getTime(), lastBatchMs: NOW.getTime() };
    expect(
      rowText(
        h(ReceiptRow, {
          item: { receipt, claim: undefined, orphan },
          ...props,
          ...(onOpen ? { onOpen } : {}),
        }),
      ),
    ).toContain('Likely agent: Muse');
    const claim = Claim.parse(makeClaim());
    const plain = rowText(
      h(ReceiptRow, { item: { receipt: verified(), claim, orphan: undefined }, ...props }),
    );
    expect(plain).not.toMatch(/likely/iu);
    expect(plain).toContain('Muse');
  });

  it('in the weekly digest', () => {
    const notable = (grade: NotableReceipt['grade']) =>
      NotableReceipt.parse({
        receiptId: ulid(5),
        agent: 'muse',
        grade,
        type: 'email.sent',
        domain: 'supplier.example',
      });
    expect(rowText(h(NotableItem, { receipt: notable('UNASKED') }))).toContain('Likely agent: Muse');
    expect(rowText(h(NotableItem, { receipt: notable('NOT_FOUND') }))).not.toMatch(/likely/iu);
  });
});

describe('an UNASKED receipt says "likely" in every text made of it', () => {
  it('in its alert, its share and the digest’s share', () => {
    const { receipt, orphan } = unasked();
    const alert = alertText(
      { receiptId: ulid(3), agent: 'muse', grade: 'UNASKED', action: undefined },
      NOW.getTime(),
    );
    expect(`${alert.title} ${alert.message}`).toMatch(/\blikely Muse\b/iu);
    expect(receiptMarkdown({ receipt, claim: undefined, observations: [orphan] })).toContain(
      'Likely agent: Muse',
    );
    const digest: DigestRecord = {
      week: '2026-10-05',
      from: iso(new Date(2026, 9, 5).getTime()),
      to: iso(new Date(2026, 9, 12).getTime()),
      createdAt: iso(NOW.getTime()),
      agents: [],
      notable: [
        NotableReceipt.parse({ receiptId: ulid(5), agent: 'muse', grade: 'UNASKED', type: 'email.sent' }),
      ],
      notableCount: 1,
      gaps: [],
      health: [],
    };
    expect(digestMarkdown(digest)).toMatch(/\blikely Muse\b/u);
  });
});
