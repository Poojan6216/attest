/**
 * The receipts as a CSV file (sprint_4 4.5; agents/ux_engineer.md: export JSON and CSV), built in the page that saves
 * it: one line per receipt, newest first, read a page at a time (`receiptPage`, ./views.ts: indexed reads of each
 * agent's receipts, at most a page and one more each) inside one read transaction, so the file is one consistent
 * snapshot; each page goes into a Blob part as it is written (./file-writer.ts).
 *
 * The columns are the receipt's own facts and the action it is about (its claim's, or for a receipt with no claim the
 * observation it found), as the ledger holds them: grades and states as stored (`NOT_FOUND`), instants as ISO 8601
 * with their offset, amounts in minor units. An override's reason and every subject hint stay out (free text; the
 * JSON export holds the whole ledger). Lines end in CRLF (RFC 4180). A cell is quoted when it holds a comma, a quote
 * or a line break, and a cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return is written after an
 * apostrophe, so no spreadsheet reads a recipient name as a formula (OWASP, CSV injection).
 */
import { EXPORT_PAGE_SIZE } from '../config';
import { AgentId } from '../core/schema';
import type { LedgerDb } from './db';
import { fileWriter } from './file-writer';
import { type ReceiptCursor, type ReceiptItem, receiptPage } from './views';

/** The header line's cells, in column order. */
export const RECEIPT_CSV_COLUMNS = [
  'receipt_id',
  'agent',
  'attribution',
  'grade',
  'state',
  'override_grade',
  'override_at',
  'action',
  'action_at',
  'counterparty',
  'amount_cents',
  'currency',
  'rule',
  'reasons',
  'confidence',
  'computed_at',
  'final_at',
  'final_from',
  'claim_id',
  'superseded_by',
] as const;

const FORMULA_START = /^[=+\-@\t\r]/u;
const NEEDS_QUOTES = /[",\r\n]/u;

/** One cell as the file writes it (header). */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const text = (value: string | number | undefined): string => (value === undefined ? '' : String(value));

/** The cells of one receipt, in `RECEIPT_CSV_COLUMNS` order. */
export function receiptCells({ receipt, claim, orphan }: ReceiptItem): readonly string[] {
  const action = claim ?? orphan;
  return [
    receipt.id,
    receipt.agent,
    text(receipt.attribution),
    receipt.grade,
    receipt.state,
    text(receipt.override?.grade),
    text(receipt.override?.at),
    text(action?.type),
    text(claim?.claimedAt ?? orphan?.occurredAt),
    text(action?.counterparty),
    text(action?.amountCents),
    text(action?.currency),
    receipt.ruleId,
    receipt.reasons.map(({ code }) => code).join(' '),
    String(receipt.confidence),
    receipt.computedAt,
    text(receipt.finalAt),
    text(receipt.finalFrom),
    text(receipt.claimId),
    text(receipt.supersededBy),
  ];
}

const line = (cells: readonly string[]): string => `${cells.map(csvCell).join(',')}\r\n`;

/** Every receipt as the CSV file (header), newest first, in pages of `pageSize`. */
export async function receiptsCsvBlob(db: LedgerDb, pageSize: number = EXPORT_PAGE_SIZE): Promise<Blob> {
  const out = fileWriter();
  out.write(line(RECEIPT_CSV_COLUMNS));
  await db.transaction('r', [db.receipts, db.claims, db.observations], async () => {
    let after: ReceiptCursor | null | undefined;
    do {
      const page = await receiptPage(db, {
        agents: AgentId.options,
        fromMs: Number.MIN_SAFE_INTEGER,
        toMs: Number.MAX_SAFE_INTEGER,
        limit: pageSize,
        ...(after === undefined || after === null ? {} : { after }),
      });
      for (const item of page.items) out.write(line(receiptCells(item)));
      out.flush();
      after = page.next;
    } while (after !== null);
  });
  return out.done('text/csv');
}
