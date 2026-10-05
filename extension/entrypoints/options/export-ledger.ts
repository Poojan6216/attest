import { query } from '../../src/bus/send';
import { LedgerExport } from '../../src/ledger/export';
import { log } from '../../src/log';

/** Hands the browser one file to save. */
export type SaveFile = (fileName: string, json: string) => void;

/** The file the browser was handed, or `null` when the ledger could not be exported (already logged). */
export type ExportResult = { readonly fileName: string } | null;

/**
 * `attest-ledger-<date>.json`, the date being the export time's own calendar date: the service worker read the
 * clock and wrote the offset (src/ledger/export.ts), so this page never reads one.
 */
export function exportFileName(exportedAt: string): string {
  return `attest-ledger-${exportedAt.slice(0, 10)}.json`;
}

/**
 * Saves `json` through a download link on an object URL. Chrome hands the download a reference to the blob when
 * the link is clicked, so the URL is released at once. Saving to the user's own disk at their click sends
 * nothing anywhere (Hard Rule 1) and needs no `downloads` permission (Hard Rule 8).
 */
export function saveJsonFile(fileName: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
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
 * The options page's "Export ledger": asks the service worker for the whole ledger (`ui.query` `ledger.export`),
 * checks the answer against the ledger's own export schema, and hands it to `save` as one JSON file in the ledger's
 * export format (`attest replay` reads it once Sprint 3.6 adds each receipt's inputs and policy to the export). Never
 * rejects: a failure is logged and resolves `null` (Hard Rule 6: the page says so).
 */
export async function exportLedgerFile(save: SaveFile = saveJsonFile): Promise<ExportResult> {
  try {
    const result = await query({ kind: 'ledger.export' });
    if (!result.ok) {
      log.warn('options.export_failed', { reason: result.error });
      return null;
    }
    const parsed = LedgerExport.safeParse(result.data);
    if (!parsed.success) {
      log.error('options.export_failed', { reason: 'malformed' });
      return null;
    }
    const fileName = exportFileName(parsed.data.exportedAt);
    save(fileName, `${JSON.stringify(parsed.data, null, 2)}\n`);
    return { fileName };
  } catch (error) {
    log.error('options.export_failed', { error });
    return null;
  }
}
