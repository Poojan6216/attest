/**
 * What the stored receipts say about every batch they lived through (docs/grading.md §4.3, §8, §9). Internal to
 * replay.ts.
 *
 * The ledger keeps one row per subject: its latest grading. Grading passes every PENDING claim to every batch and
 * never regrades a FINAL or overridden receipt, so a claim's stored receipt tells exactly when the claim was in a
 * batch: from its first sighting (`observedAt`) up to the receipt's `computedAt` (its last grading). The fixed
 * pre-assignments of each batch are batch-fixed.ts `preAssignments` of the stored receipts, kept where in force at
 * the batch's instant (`fixedInForce`): the one rule `gradeBatch` applies to the pre-assignments it is given, so
 * replay fixes exactly what the batch fixed (Hard Rule 4). A receipt is replayed in its own batch, so nothing it
 * fixes is in force there. Nothing here reads a stored `grade` or `ruleId`, so a tampered grade changes no other
 * receipt's replay.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import {
  type BatchFixed,
  type FixedAt,
  fixedInForce,
  latestClaimReceipts,
  preAssignments,
} from './batch-fixed';
import { instantMs } from './normalize';
import { compareText } from './order';
import type { Receipt, Ulid } from './schema';

/** A claim and the instant of its latest grading. */
interface ClaimStanding {
  readonly claimId: Ulid;
  readonly computedMs: number;
}

/** A claim as the snapshot holds it, with its `observedAt` instant. */
export interface SeenClaim<C> {
  readonly claim: C;
  readonly observedMs: number;
}

/** The stored receipts read as a timeline of batch membership and pre-assignments. */
export class Timeline {
  readonly #claims: readonly ClaimStanding[];
  readonly #fixed: readonly BatchFixed[];

  constructor(receipts: readonly Receipt[]) {
    this.#claims = [...latestClaimReceipts(receipts)].map(([claimId, receipt]) => ({
      claimId,
      computedMs: instantMs(receipt.computedAt),
    }));
    this.#fixed = preAssignments(receipts);
  }

  /**
   * The claims in the batch at `atMs`: first seen by then and graded at or after it, in claim id order. `seen`
   * finds a claim and its `observedAt` instant (undefined for a claim the snapshot lacks: it is in no batch).
   */
  batchClaims<C>(atMs: number, seen: (claimId: Ulid) => SeenClaim<C> | undefined): C[] {
    const found: { readonly id: Ulid; readonly claim: C }[] = [];
    for (const standing of this.#claims) {
      const held = seen(standing.claimId);
      if (held === undefined || held.observedMs > atMs || atMs > standing.computedMs) continue;
      found.push({ id: standing.claimId, claim: held.claim });
    }
    return found.sort((a, b) => compareText(a.id, b.id)).map((one) => one.claim);
  }

  /** The fixed pairs and taken observations in force at `atMs`, in claim id and observation id order. */
  fixedAt(atMs: number): FixedAt {
    return fixedInForce(this.#fixed, atMs);
  }
}
