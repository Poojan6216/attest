/**
 * What the Gmail auto-check decides with (sprint_4 4.9; src/background/auto-check.ts), read at one instant of the
 * ledger: each `email.sent` claim whose receipt is PENDING with no mark of the person's, with when Attest read the
 * claim (its `observedAt`); when a Gmail Sent list was last read (the newest `gmail.sent` coverage ping's
 * `lastSyncAt`); and the last time it opened Gmail (./auto-check-record.ts, which it records).
 */
import { latestClaimReceipts } from '../core/batch-fixed';
import { instantMs } from '../core/normalize';
import { compareText } from '../core/order';
import { type AgentId, Claim, Receipt, type Ulid } from '../core/schema';
import { type AutoCheckRecord, readAutoCheck } from './auto-check-record';
import { readRows, type LedgerDb } from './db';
import { CoveragePing } from './types';

export {
  AUTO_CHECK_AGENTS,
  AUTO_CHECK_AT,
  AUTO_CHECK_CLAIMS,
  AUTO_CHECK_UNTIL,
  type AutoCheckRecord,
  autoCheckWaitMs,
  readAutoCheck,
  recordAutoCheck,
} from './auto-check-record';

/** An `email.sent` claim still checking: its id, its agent, and when Attest read it, in epoch ms. */
export interface CheckingEmailClaim {
  readonly id: Ulid;
  readonly agent: AgentId;
  readonly observedMs: number;
}

/** What one auto-check decides with (header). */
export interface AutoCheckInputs {
  readonly claims: readonly CheckingEmailClaim[];
  /** When a Gmail Sent list was last read, in epoch ms; null when none ever was. */
  readonly gmailSyncMs: number | null;
  readonly last: AutoCheckRecord | null;
}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

/** The `email.sent` claims whose receipt is PENDING and unmarked, oldest read first. */
async function checkingEmailClaims(db: LedgerDb): Promise<CheckingEmailClaim[]> {
  const pending = latestClaimReceipts(
    readRows('receipts', Receipt, await db.receipts.where('state').equals('PENDING').toArray()),
  );
  const unmarked = [...pending.values()].filter((receipt) => receipt.override === undefined);
  const claims = readRows(
    'claims',
    Claim,
    (
      await db.claims.bulkGet(unmarked.flatMap(({ claimId }) => (claimId === undefined ? [] : [claimId])))
    ).filter(isDefined),
  );
  return claims
    .filter((claim) => claim.type === 'email.sent')
    .map((claim) => ({ id: claim.id, agent: claim.agent, observedMs: instantMs(claim.observedAt) }))
    .sort((a, b) => a.observedMs - b.observedMs || compareText(a.id, b.id));
}

/** The auto-check's inputs (header), in one read transaction. */
export async function autoCheckInputs(db: LedgerDb): Promise<AutoCheckInputs> {
  return db.transaction('r', [db.receipts, db.claims, db.coverage, db.meta], async () => {
    const [claims, pings, last] = await Promise.all([
      checkingEmailClaims(db),
      db.coverage.toArray(),
      readAutoCheck(db),
    ]);
    const synced = readRows('coverage', CoveragePing, pings)
      .filter((ping) => ping.source === 'gmail.sent')
      .map((ping) => instantMs(ping.lastSyncAt));
    return { claims, gmailSyncMs: synced.length === 0 ? null : Math.max(...synced), last };
  });
}
