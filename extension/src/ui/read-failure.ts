/**
 * What a read that failed shows (sprint_6 6.5; Sprint 6 close, tech review TECH-8 and TECH-14): a locked ledger is no
 * failure, so it is never logged as one, and the page offers the unlock; anything else is logged by `logFailed`, under
 * the page's own event, and said.
 */
import { isLedgerLocked } from '../ledger/errors';

export function readFailure(error: unknown, logFailed: (error: unknown) => void): 'locked' | 'failed' {
  if (isLedgerLocked(error)) return 'locked';
  logFailed(error);
  return 'failed';
}
