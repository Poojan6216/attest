/**
 * Saves what a person chose for one agent, and whether its alerts are muted (sprint_4 4.4; the options page's Grants,
 * through the service worker: src/background/grant-save.ts). One readwrite transaction over `grants` and `meta`:
 *  - the grant is the person's choices with what Attest observed kept from the stored grant (`observedScopes`, from
 *    the vendor's settings page, and `accounts`), so a page read before an observed change never puts back what that
 *    change replaced. It replaces the agent's grant (one per agent);
 *  - its `updatedAt` is stamped there, at now, or 1 ms after the last grading batch when the clock reads at or before
 *    it (`stampEventAt`, as a user event is stamped), so it is in force only in batches after it (docs/grading.md §3:
 *    the grant in force is the latest `updatedAt ≤ evaluatedAt`);
 *  - it is a stored fact read at now (`noteStoredInstant`): the next batch grades even with no receipt PENDING (a
 *    narrower declared access can add a scope receipt), and a clock that comes back below now is noticed, and the
 *    grant re-stamped where every later batch sees it (./clock-guard.ts);
 *  - the mute is the meta flag `alertsMuted.<agent>`.
 */
import { nowIso } from '../clock';
import { alertsMutedKey } from './agent-keys';
import { lastBatchMs, stampEventAt } from './batch-instant';
import { noteStoredInstant } from './clock-high-water';
import type { LedgerDb } from './db';
import { getGrant, putGrant, setMeta } from './repo';
import { type Grant, type GrantChoices, IsoTs } from './types';

/** The grant `choices` make at `at`, keeping what `stored` observed (each field taken by name, nothing else). */
function grantOf(choices: GrantChoices, stored: Grant | undefined, at: IsoTs): Grant {
  const { agent, allowedTypes, counterpartyAllowlist, spendCeilingCents, spendCurrency, declaredScopes } =
    choices;
  return {
    agent,
    allowedTypes,
    counterpartyAllowlist,
    spendCeilingCents,
    ...(spendCurrency === undefined ? {} : { spendCurrency }),
    declaredScopes,
    ...(stored?.observedScopes === undefined ? {} : { observedScopes: stored.observedScopes }),
    ...(stored?.accounts === undefined ? {} : { accounts: stored.accounts }),
    updatedAt: at,
  };
}

/** Saves the grant `choices` make and the agent's mute; returns the grant's stamp. */
export async function saveGrant(db: LedgerDb, choices: GrantChoices, muted: boolean): Promise<IsoTs> {
  return db.transaction('rw', [db.grants, db.meta], async () => {
    const now = IsoTs.parse(nowIso());
    const at = stampEventAt(now, await lastBatchMs(db));
    await putGrant(db, grantOf(choices, await getGrant(db, choices.agent), at));
    await setMeta(db, alertsMutedKey(choices.agent), muted);
    await noteStoredInstant(db, now);
    return at;
  });
}
