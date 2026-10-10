/**
 * Alerts (sprint_4 4.6; Hard Rules 6, 7, 10): one per receipt a grading batch made FINAL with grade NOT_FOUND, UNASKED
 * or OVER_SCOPE, ever. Two steps, each in one readwrite transaction:
 *  - `queueAlerts`, in the batch's own transaction (src/background/grading.ts): each receipt the batch wrote FINAL with
 *    an alerting grade, and not superseded, gets a `pending` row keyed by its id, unless it has a row already. A FINAL
 *    receipt is never graded again, so no later batch queues it again;
 *  - `takeAlerts`, after each batch and at every start of the service worker (for one that stopped in between): each
 *    pending row is settled for good, before any notification is asked for: `shown`, or `muted` when the person muted
 *    the agent's alerts (meta `alertsMuted.<agent>`, sprint_4 4.4), `superseded` when a later claim explained an UNASKED
 *    receipt, `overridden` when the person marked the receipt first, `gone` when it was purged first. A worker that
 *    stops after it settled a row and before Chrome showed the notification loses that notification rather than
 *    showing it twice: one per receipt, ever, is at most one.
 * A settled row goes with its receipt in the retention purge (./retention.ts), and with everything in Delete all data.
 */
import { ALERTS_PER_TAKE } from '../config';
import { alertsMutedKey } from './agent-keys';
import { readRow, readRows, type LedgerDb } from './db';
import {
  type ActionType,
  type AgentId,
  AlertGrade,
  AlertRecord,
  type AlertState,
  Claim,
  type IsoTs,
  MetaEntry,
  Observation,
  Receipt,
} from './types';

export { ALERTS_PER_TAKE } from '../config';

const isAlertGrade = (grade: string): grade is AlertGrade => AlertGrade.safeParse(grade).success;

/** Queues an alert for each of `receipts` that alerts and has none (header); returns how many. */
export async function queueAlerts(db: LedgerDb, receipts: readonly Receipt[]): Promise<number> {
  // One receipt given twice is queued once: a second copy would abort the batch's transaction (QA review GAP 8).
  const unique = [...new Map(receipts.map((receipt) => [receipt.id, receipt])).values()];
  const alerting = unique.flatMap((receipt) => {
    const { state, grade, supersededBy, finalAt } = receipt;
    if (state !== 'FINAL' || !isAlertGrade(grade) || supersededBy !== undefined || finalAt === undefined)
      return [];
    return [
      AlertRecord.parse({ receiptId: receipt.id, agent: receipt.agent, grade, state: 'pending', finalAt }),
    ];
  });
  if (alerting.length === 0) return 0;
  const held = await db.alerts.bulkGet(alerting.map(({ receiptId }) => receiptId));
  const fresh = alerting.filter((_, index) => held[index] === undefined);
  await db.alerts.bulkAdd(fresh);
  return fresh.length;
}

/** What one alert says it is about: the claim's action and its time, or the observation an UNASKED receipt found. */
export interface AlertAction {
  readonly type: ActionType;
  readonly at: IsoTs;
}

/** An alert to show: its receipt, agent and grade, and the action, when the receipt is about one. */
export interface AlertToShow {
  readonly receiptId: string;
  readonly agent: AgentId;
  readonly grade: AlertGrade;
  readonly action: AlertAction | undefined;
}

export interface TakenAlerts {
  readonly shown: readonly AlertToShow[];
  /** How many were settled without a notification, by state. */
  readonly quiet: Readonly<Partial<Record<AlertState, number>>>;
}

/** The state a pending alert settles to, given its receipt (or none) and whether its agent is muted. */
function settle(receipt: Receipt | undefined, muted: boolean): AlertState {
  if (receipt === undefined) return 'gone';
  if (receipt.state === 'USER_OVERRIDDEN') return 'overridden';
  if (receipt.supersededBy !== undefined) return 'superseded';
  return muted ? 'muted' : 'shown';
}

/** The action `receipt` is about: its claim's, or its first observation's (an UNASKED receipt's orphan). */
async function actionOf(db: LedgerDb, receipt: Receipt): Promise<AlertAction | undefined> {
  if (receipt.claimId !== undefined) {
    const claim = readRow('claims', Claim, await db.claims.get(receipt.claimId));
    return claim === undefined ? undefined : { type: claim.type, at: claim.claimedAt };
  }
  const [first] = receipt.observationIds;
  if (first === undefined) return undefined;
  const observation = readRow('observations', Observation, await db.observations.get(first));
  return observation === undefined ? undefined : { type: observation.type, at: observation.occurredAt };
}

/** How many alerts are pending, by the `state` index: a grace alarm delivers when there are any (TECH-6). */
export async function pendingAlertCount(db: LedgerDb): Promise<number> {
  return db.alerts.where('state').equals('pending').count();
}

/** Settles up to `ALERTS_PER_TAKE` pending alerts at `handledAt` (header); returns the ones to show. */
export async function takeAlerts(db: LedgerDb, handledAt: IsoTs): Promise<TakenAlerts> {
  const tables = [db.alerts, db.receipts, db.claims, db.observations, db.meta];
  return db.transaction('rw', tables, async (): Promise<TakenAlerts> => {
    const pending = readRows(
      'alerts',
      AlertRecord,
      await db.alerts.where('state').equals('pending').limit(ALERTS_PER_TAKE).toArray(),
    );
    const shown: AlertToShow[] = [];
    const quiet: Partial<Record<AlertState, number>> = {};
    for (const alert of pending) {
      const receipt = readRow('receipts', Receipt, await db.receipts.get(alert.receiptId));
      const mute = readRow('meta', MetaEntry, await db.meta.get(alertsMutedKey(alert.agent)));
      const state = settle(receipt, mute?.value === true);
      await db.alerts.put({ ...alert, state, handledAt });
      if (state === 'shown' && receipt !== undefined) {
        const { receiptId, agent, grade } = alert;
        shown.push({ receiptId, agent, grade, action: await actionOf(db, receipt) });
      } else {
        quiet[state] = (quiet[state] ?? 0) + 1;
      }
    }
    return { shown, quiet };
  });
}
