/**
 * What the options page reads from the ledger (sprint_4 4.4, 4.5): every agent's grant and whether its alerts are
 * muted, the retention window in force, the person's choices (src/ledger/consent.ts), each reader's health, and where
 * the ledger's encryption stands (sprint_6 6.5). Moved
 * out of ./data.ts in the Sprint 4 close (tech review TECH-5), so the popup's start loads none of it. Readers only,
 * through the page's own connection to the ledger (src/ledger/shared.ts); the service worker writes.
 */
import type { ReaderId } from '../config';
import { SEALED_TABLES } from '../config-crypto';
import { isLocked } from '../crypto/keyring';
import { type CryptoJob, isGuarded, type JobFailure, readCryptoState } from '../ledger/crypto-state';
import { type Flags, readersOff, readFlags } from '../ledger/consent';
import { readRebuildMark } from '../ledger/rebuild-mark';
import { readRetentionDays, type RetentionChoice } from '../ledger/settings';
import { getLedger } from '../ledger/shared';
import type { AdapterHealth } from '../ledger/types';
import { grantSettings, type GrantSettings, healthReports } from '../ledger/views';

export type { GrantSettings } from '../ledger/views';
/** The saved key's vendor: read by every page now (./privacy-data.ts), and by the options page's Model section. */
export { loadByoVendor } from './privacy-data';

/** The latest health report of every adapter and observer. */
export async function loadHealth(): Promise<AdapterHealth[]> {
  return healthReports(await getLedger());
}

/** The options page's Grants: every agent's grant, and each agent whose alerts are muted. */
export async function loadGrantSettings(): Promise<GrantSettings> {
  return grantSettings(await getLedger());
}

/** The retention window in force (sprint_4 4.5): what the options page's Privacy shows. */
export async function loadRetentionDays(): Promise<RetentionChoice> {
  return readRetentionDays(await getLedger());
}

/** The person's choices the options page shows (src/ledger/consent.ts): the readers that are off, and the flags. */
export async function loadConsent(): Promise<{ readersOff: ReadonlySet<ReaderId>; flags: Flags }> {
  const db = await getLedger();
  return { readersOff: await readersOff(db), flags: await readFlags(db) };
}

/** Where the ledger's encryption stands (sprint_6 6.5), for the options page's Encryption. */
export interface CryptoStatus {
  /** Encryption is on, or a job turning it on or off is not finished. */
  readonly on: boolean;
  /** On, and this page holds no key: nothing sealed can be read. */
  readonly locked: boolean;
  /**
   * The job rewriting the rows, if one is under way: which, which table of how many it is in, and, when its last step
   * failed, why (tech review TECH-2): it has stopped, and waits for the grace alarm or the person's Try again.
   */
  readonly job?: {
    readonly kind: CryptoJob;
    readonly table: number;
    readonly of: number;
    readonly stopped?: JobFailure;
  };
  /**
   * The ledger's database is being rebuilt after a job, or will be (Sprint 6 close, security review SEC-1;
   * src/ledger/rebuild.ts): reads wait meanwhile.
   */
  readonly rebuilding?: true;
}

/**
 * The ledger's encryption state, and whether this page holds its key: `meta` only, readable while locked. While the
 * service worker rebuilds the ledger's database, that alone, from the session's mark: the ledger waits to be read.
 */
export async function loadCryptoStatus(): Promise<CryptoStatus> {
  if (await readRebuildMark()) return { on: true, locked: isLocked(), rebuilding: true };
  const state = await readCryptoState(await getLedger());
  const on = isGuarded(state);
  const job =
    state.job === undefined
      ? undefined
      : {
          kind: state.job,
          table: Math.max(0, SEALED_TABLES.indexOf(state.jobTable ?? '')) + 1,
          of: SEALED_TABLES.length,
          ...(state.jobFailed === undefined ? {} : { stopped: state.jobFailed }),
        };
  return {
    on,
    locked: on && isLocked(),
    ...(job === undefined ? {} : { job }),
    ...(state.rebuild === true ? { rebuilding: true as const } : {}),
  };
}
