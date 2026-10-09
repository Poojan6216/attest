import 'fake-indexeddb/auto';
/**
 * The receipts CSV the options page builds (sprint_4 4.5; src/ledger/export-csv.ts): a header and one CRLF line per
 * receipt, newest first, with the action it is about (its claim's, or an UNASKED receipt's observation); the same
 * bytes at every page size, every read bounded by a page; and cells a spreadsheet cannot read as a formula, quoted
 * when they must be. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { LedgerDb } from '../../../src/ledger/db';
import { csvCell, RECEIPT_CSV_COLUMNS, receiptsCsvBlob } from '../../../src/ledger/export-csv';
import { openLedger } from '../../../src/ledger/migrations';
import { putReceipt, upsertClaim, upsertObservation } from '../../../src/ledger/repo';
import {
  claimId,
  makeClaim,
  makeObservation,
  makeReceipt,
  observationId,
  omit,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';
import { recordReads } from './read-recorder';

let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-08T17:00:00-04:00');
  db = await openLedger(uniqueDbName('export-csv'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const ORPHAN = makeObservation({ rowKeyHash: sha(1) });

/** A claim's receipt graded at 10:31, and an UNASKED one about an observation, graded at 11:00 (newest). */
async function populate(): Promise<void> {
  await upsertObservation(db, ORPHAN, DEFAULT_POLICY);
  await upsertClaim(db, makeClaim({ rawHash: sha(101) }));
  await putReceipt(db, makeReceipt({ id: ulid(1), claimId: claimId(101) }));
  const unasked = makeReceipt({
    id: ulid(2),
    agent: 'claude',
    grade: 'UNASKED',
    ruleId: 'unasked',
    reasons: [{ code: 'unasked.session', params: { agent: 'claude' } }],
    observationIds: [observationId(1)],
    state: 'FINAL',
    computedAt: '2026-10-01T11:00:00-04:00',
    finalAt: '2026-10-01T11:00:00-04:00',
  });
  await putReceipt(db, { ...omit(unasked, 'claimId'), attribution: 'likely' });
}

/** The UNASKED receipt's line: about the observation it found, newest. */
const UNASKED_LINE = [
  ulid(2),
  'claude',
  'likely',
  'UNASKED',
  'FINAL',
  '',
  '',
  ORPHAN.type,
  ORPHAN.occurredAt,
  ORPHAN.counterparty ?? '',
  '',
  '',
  'unasked',
  'unasked.session',
  '0.92',
  '2026-10-01T11:00:00-04:00',
  '2026-10-01T11:00:00-04:00',
  '',
  '',
  '',
].join(',');

/** The claim's receipt's line. */
const CLAIM_LINE = [
  ulid(1),
  'muse',
  '',
  'VERIFIED',
  'PENDING',
  '',
  '',
  'email.sent',
  '2026-10-01T10:14:00-04:00',
  'alice@example.com',
  '',
  '',
  'verified',
  'match.best',
  '0.92',
  '2026-10-01T10:31:00-04:00',
  '',
  '',
  claimId(101),
  '',
].join(',');

describe('receiptsCsvBlob', () => {
  it('writes the header and one line per receipt, newest first, with the action it is about', async () => {
    await populate();
    const blob = await receiptsCsvBlob(db);
    expect(blob.type).toBe('text/csv');
    const lines = (await blob.text()).split('\r\n');
    expect(lines).toEqual([RECEIPT_CSV_COLUMNS.join(','), UNASKED_LINE, CLAIM_LINE, '']);
  });

  it('writes the same bytes at every page size, and no read returns more than a page and one', async () => {
    await populate();
    const whole = await (await receiptsCsvBlob(db, 500)).text();
    const recorder = await recordReads(db);
    expect(await (await receiptsCsvBlob(db, 1)).text()).toBe(whole);
    // Each agent's receipts are read newest first a page and one more at a time; claims and observations by key.
    expect(recorder.reads.length).toBeGreaterThan(0);
    for (const read of recorder.reads)
      expect(read.delivered, `${read.table} ${read.op}`).toBeLessThanOrEqual(2);
  });

  it('writes only the header for a ledger with no receipt', async () => {
    expect(await (await receiptsCsvBlob(db)).text()).toBe(`${RECEIPT_CSV_COLUMNS.join(',')}\r\n`);
  });
});

describe('csvCell', () => {
  it('quotes what must be quoted, and writes a would-be formula after an apostrophe', () => {
    expect(csvCell('priya@example.com')).toBe('priya@example.com');
    expect(csvCell('Acme, Inc.')).toBe('"Acme, Inc."');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    for (const formula of ['=1+2', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      expect(csvCell(formula).startsWith(`'`) || csvCell(formula).startsWith(`"'`), formula).toBe(true);
    }
    expect(csvCell('=HYPERLINK("https://example.com","x")')).toBe(
      `"'=HYPERLINK(""https://example.com"",""x"")"`,
    );
    expect(csvCell('')).toBe('');
  });
});
