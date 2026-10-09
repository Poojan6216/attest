/**
 * Away detection (sprint_3 3.14; docs/grading.md §7 `userIdle`; Hard Rule 8): off unless the person turns it on in the
 * options page, which asks Chrome for the optional `idle` permission. While it is on, Chrome tells the service worker
 * when the person goes away (no input for IDLE_DETECTION_SECONDS, or the screen locked) and when they come back, and
 * the ledger keeps each time away as an interval: two instants, nothing of what the person did (../ledger/activity.ts).
 * Positive evidence only: an interval starts at the last instant input could have been, and ends when Chrome says
 * the person is back. Turning it off removes the permission and every stored interval (`onPermissionsRemoved`).
 *
 * Chrome's `idle` namespace exists only while the permission is held, so `watchIdle` takes it as it is (undefined
 * without the permission). The background entry calls it synchronously at start (MV3: a listener registered then
 * wakes a stopped worker), and again when the permission is granted while the worker runs.
 */
import { isoWithLocalOffset } from '../clock';
import { IDLE_DETECTION_SECONDS, IDLE_PERMISSION } from '../config';
import { IsoTs } from '../core/schema';
import { closeIdle, forgetIdle, openIdle } from '../ledger/activity';
import type { LedgerDb } from '../ledger/db';
import { getLedger } from '../ledger/repo';
import { log } from '../log';

export type IdleState = 'active' | 'idle' | 'locked';

/** The part of Chrome's `idle` namespace away detection uses. */
export interface IdleApi {
  setDetectionInterval(intervalInSeconds: number): void;
  readonly onStateChanged: { addListener(callback: (state: IdleState) => void): void };
}

const isoAt = (ms: number): IsoTs => IsoTs.parse(isoWithLocalOffset(new Date(ms)));

/** Stores what Chrome reported at the clock reading `nowMs`: an interval opened, or the open one closed. */
export async function recordIdleState(db: LedgerDb, state: IdleState, nowMs: number): Promise<void> {
  if (state === 'active') {
    await closeIdle(db, isoAt(nowMs));
    return;
  }
  const fromMs = state === 'idle' ? nowMs - IDLE_DETECTION_SECONDS * 1_000 : nowMs;
  await openIdle(db, isoAt(fromMs), isoAt(nowMs));
}

let watching = false;

/** Listens to Chrome's idle states when `api` is there (the permission is held), once; returns whether it listens. */
export function watchIdle(
  api: IdleApi | undefined,
  db: () => Promise<LedgerDb> = getLedger,
  nowMs: () => number = () => Date.now(),
): boolean {
  if (api === undefined) return false;
  if (watching) return true;
  watching = true;
  api.setDetectionInterval(IDLE_DETECTION_SECONDS);
  api.onStateChanged.addListener((state) => {
    db()
      .then((ledger) => recordIdleState(ledger, state, nowMs()))
      .catch((error: unknown) => {
        log.error('idle.record_failed', { error });
      });
  });
  return true;
}

/** `permissions.onRemoved`: when the person turned away detection off, every idle interval goes with it. */
export async function onPermissionsRemoved(
  removed: { readonly permissions?: readonly string[] },
  db: () => Promise<LedgerDb> = getLedger,
): Promise<void> {
  if (!(removed.permissions ?? []).includes(IDLE_PERMISSION)) return;
  const count = await forgetIdle(await db());
  log.info('idle.forgotten', { intervalCount: count });
}
