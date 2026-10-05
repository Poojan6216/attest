/**
 * docs/adapters.md explains every reason code a DEGRADED health report can carry and every code a refused observer
 * message is answered with (sprint_2 2.9: "every PASS_REASONS and per-observer reason code and how to read a DEGRADED
 * reason"; Hard Rule 6: a DEGRADED the user cannot read is no better than a silent one). The lists come from the
 * code, so a reason added without a line in the doc fails here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RowCode } from '../../../src/background/observer-messages';
import { AckCode } from '../../../src/bus/messages';
import { LEDGER_REASON_PREFIX } from '../../../src/ledger/health';
import { GCAL_REASONS } from '../../../src/observers/gcal/read';
import { SENT_HEALTH_REASONS } from '../../../src/observers/gmail/health';
import type { Landmark } from '../../../src/observers/gmail/receipts/message';
import { UNREADABLE_REASONS } from '../../../src/observers/gmail/receipts/parser';
import { PASS_REASONS } from '../../../src/observers/plan';

const DOC = readFileSync(path.resolve(import.meta.dirname, '../../../../docs/adapters.md'), 'utf8');

/** The landmarks a receipt pass reports as `selector.missing.<landmark>` (./receipts/health.ts). */
const RECEIPT_LANDMARKS = [
  'main',
  'subject',
  'message',
  'sender',
  'date',
] as const satisfies readonly Landmark[];
/** The row refusals the service worker reports as `ledger.<code>` (src/background/observer-messages.ts). */
const ROW_CODES = ['invalid_input', 'id_conflict', 'late_sighting'] as const satisfies readonly RowCode[];

// Both lists must name every member of their union: a landmark or row code added in the code fails the typecheck.
type Missing<Union, Listed> = [Exclude<Union, Listed>] extends [never] ? true : false;
const landmarksComplete: Missing<Landmark, (typeof RECEIPT_LANDMARKS)[number]> = true;
const rowCodesComplete: Missing<RowCode, (typeof ROW_CODES)[number]> = true;

const RECEIPT_REASONS = [
  ...RECEIPT_LANDMARKS.map((landmark) => `selector.missing.${landmark}`),
  ...UNREADABLE_REASONS,
];
const LEDGER_REASONS = ROW_CODES.map((code) => `${LEDGER_REASON_PREFIX}${code}`);

/** Every reason code a stored health report can carry. */
const REASONS: readonly (readonly [string, readonly string[]])[] = [
  ['the pass', PASS_REASONS],
  ['gmail.sent', SENT_HEALTH_REASONS],
  ['gmail.receipt', RECEIPT_REASONS],
  ['gcal.event', GCAL_REASONS],
  ['the service worker', LEDGER_REASONS],
];

/** The lines of the doc's section whose heading names `title` (its own text, up to the next heading). */
function section(title: string): string {
  const lines = DOC.split('\n');
  const start = lines.findIndex((line) => /^#{2,4} /.test(line) && line.includes(title));
  if (start === -1) return '';
  const end = lines.findIndex((line, index) => index > start && /^#{2,4} /.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

describe('docs/adapters.md explains every DEGRADED reason', () => {
  it('both hand-kept lists name every member of their type', () => {
    expect([landmarksComplete, rowCodesComplete]).toEqual([true, true]);
  });

  it.each(REASONS.flatMap(([who, codes]) => codes.map((code) => [who, code] as const)))(
    '%s: %s is a row of a reason table',
    (_who, code) => {
      expect(DOC).toMatch(new RegExp(`^\\| [^\\n]*\`${code.replace(/\./g, '\\.')}\`[^\\n]* \\|`, 'm'));
    },
  );

  it.each([...PASS_REASONS])('pass reason %s is in §4.1', (code) => {
    expect(section('4.1 Pass reasons')).toContain(`\`${code}\``);
  });

  it.each([...SENT_HEALTH_REASONS])('gmail.sent reason %s is in §4.2', (code) => {
    expect(section('4.2 `gmail.sent` reasons')).toContain(`\`${code}\``);
  });

  it.each(RECEIPT_REASONS)('gmail.receipt reason %s is in §4.3', (code) => {
    expect(section('4.3 `gmail.receipt` reasons')).toContain(`\`${code}\``);
  });

  it.each([...GCAL_REASONS])('gcal.event reason %s is in §4.4', (code) => {
    expect(section('4.4 `gcal.event` reasons')).toContain(`\`${code}\``);
  });

  it.each(LEDGER_REASONS)('service worker reason %s is in §4.5', (code) => {
    expect(section('4.5 Reasons the service worker sets')).toContain(`\`${code}\``);
  });

  it.each([...AckCode.options])('acknowledgement code %s is explained in §3.4', (code) => {
    expect(section('3.4 Acknowledgements')).toMatch(new RegExp(`^\\| \`${code}\` \\|`, 'm'));
  });
});
