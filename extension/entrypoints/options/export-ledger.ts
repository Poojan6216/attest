/**
 * The options page's exports (sprint_4 4.5): the whole ledger as one JSON file, and the receipts as one CSV file. Each
 * is built here, from this page's own connection to the ledger (src/ledger/shared.ts), a page of rows at a time
 * (src/ledger/export-file.ts, src/ledger/export-csv.ts), and handed to the browser to save. The service worker is not
 * asked: its single-message export (`ui.query` `ledger.export`) stays for the test harness only (Sprint 0 close,
 * TECH-10). Saving to the person's own disk at their click sends nothing anywhere (Hard Rule 1) and needs no
 * `downloads` permission (Hard Rule 8).
 */
import { nowIso } from '../../src/clock';
import { receiptsCsvBlob } from '../../src/ledger/export-csv';
import { isLedgerLocked } from '../../src/ledger/errors';
import { exportLedgerBlob } from '../../src/ledger/export-file';
import { getLedger } from '../../src/ledger/shared';
import { log } from '../../src/log';

/** Hands the browser one file to save. */
export type SaveFile = (fileName: string, file: Blob) => void;

/** What the page exports: the whole ledger (JSON) or the receipts (CSV). */
export type ExportKind = 'ledger' | 'receipts';

/**
 * The file the browser was handed; `locked` when the ledger is encrypted and locked (sprint_6 6.5: nothing is read, so
 * nothing is exported until it is unlocked); or `null` when the export failed (already logged).
 */
export type ExportResult = { readonly fileName: string } | 'locked' | null;

/**
 * `attest-ledger-<date>.json` or `attest-receipts-<date>.csv`, the date being the export time's own calendar date
 * (the page's clock writes its own offset, src/clock.ts), never UTC's.
 */
export function exportFileName(kind: ExportKind, exportedAt: string): string {
  const date = exportedAt.slice(0, 10);
  return kind === 'ledger' ? `attest-ledger-${date}.json` : `attest-receipts-${date}.csv`;
}

/**
 * Saves `file` through a download link on an object URL. Chrome hands the download a reference to the blob when the
 * link is clicked, so the URL is released at once.
 */
export function saveFile(fileName: string, file: Blob): void {
  const url = URL.createObjectURL(file);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Builds the `kind` export at the page's clock and hands it to `save`. Never rejects: a locked ledger resolves `locked`,
 * and any other failure is logged and resolves `null` (Hard Rule 6: the page says so).
 */
export async function exportFile(
  kind: ExportKind,
  save: SaveFile = saveFile,
  clock: () => string = nowIso,
): Promise<ExportResult> {
  try {
    const exportedAt = clock();
    const db = await getLedger();
    const file = kind === 'ledger' ? await exportLedgerBlob(db, { exportedAt }) : await receiptsCsvBlob(db);
    const fileName = exportFileName(kind, exportedAt);
    save(fileName, file);
    return { fileName };
  } catch (error) {
    if (isLedgerLocked(error)) return 'locked';
    log.error('options.export_failed', { error });
    return null;
  }
}
