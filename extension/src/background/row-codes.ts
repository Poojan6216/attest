/**
 * The refusals a row can meet in the ledger (src/ledger/repo.ts `upsertObservation`), worst first: the closed codes
 * a refused pass answers with and the service worker's DEGRADED reasons are built from (`ledger.<code>`;
 * docs/adapters.md §3.4, §4.5; Hard Rule 6).
 */
import { LedgerError } from '../ledger/errors';

export const ROW_CODES = ['invalid_input', 'id_conflict', 'late_sighting'] as const;
export type RowCode = (typeof ROW_CODES)[number];

export const isRowCode = (code: string): code is RowCode => (ROW_CODES as readonly string[]).includes(code);

/** The worst of `codes` (ROW_CODES order). */
export function worstCode(codes: ReadonlySet<RowCode>): RowCode {
  return ROW_CODES.find((code) => codes.has(code)) ?? 'invalid_input';
}

/** The row code of a ledger refusal, or undefined for any other error (a bug, which must fail loud). */
export function rowCodeOf(error: unknown): RowCode | undefined {
  return error instanceof LedgerError && isRowCode(error.code) ? error.code : undefined;
}
