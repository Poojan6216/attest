/**
 * What the stored receipts say about every batch they lived through (docs/grading.md §4.3, §8, §9). Internal to
 * replay.ts.
 *
 * The ledger keeps one row per subject: its latest grading. Grading passes every PENDING claim to every batch and
 * never regrades a FINAL or overridden receipt, so a claim's stored receipt tells exactly when the claim was in a
 * batch: from its first sighting (`observedAt`) up to the receipt's `computedAt` (its last grading). After that it
 * is a fixed pre-assignment (§4.3):
 *  - a FINAL receipt fixes its `observationIds` to its claim;
 *  - an override, from its `at` on, fixes the stored `observationIds`, none for an override to NOT_FOUND; before its
 *    `at`, the state it overrode applies (FINAL: as above; PENDING: nothing, and no batch can have run in between
 *    without regrading the claim, which would have moved `computedAt`);
 *  - an overridden UNASKED receipt (claim-less, naming its orphan) marks that observation taken from its `at` on;
 *    a FINAL UNASKED receipt fixes nothing: its observation stays assignable (§7).
 * A receipt is replayed in its own batch, so nothing is fixed in it: fixing starts strictly after `computedAt`.
 * Nothing here reads a stored `grade` or `ruleId`, so a tampered grade changes no other receipt's replay.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import type { FixedPair } from './candidates';
import { instantMs } from './normalize';
import type { Receipt, Ulid } from './schema';

/** A claim receipt's place in time. */
interface ClaimStanding {
  readonly claimId: Ulid;
  readonly computedMs: number;
  /** What the receipt fixes while FINAL; null when it was PENDING until an override. */
  readonly asFinal: readonly Ulid[] | null;
  /** The override's `at`, or null when the receipt is not overridden. */
  readonly overrideMs: number | null;
  /** What the override fixes (§4.3: the stored `observationIds`, none for an override to NOT_FOUND). */
  readonly asOverridden: readonly Ulid[];
}

/** An overridden UNASKED receipt: its orphan is taken after its own batch, from the override's `at` on. */
interface TakenStanding {
  readonly observationId: Ulid;
  readonly computedMs: number;
  readonly overrideMs: number;
}

/** A claim as the snapshot holds it, with its `observedAt` instant. */
export interface SeenClaim<C> {
  readonly claim: C;
  readonly observedMs: number;
}

/** The pre-assignments in force at one instant (§4.3 `assign(pairs, policy, fixed, taken)`). */
export interface FixedAt {
  readonly fixed: readonly FixedPair[];
  readonly taken: ReadonlySet<Ulid>;
}

/** (`computedAt` instant, id): the later grading of one subject wins. */
function later(a: ClaimStanding, aId: Ulid, b: ClaimStanding, bId: Ulid): boolean {
  if (a.computedMs !== b.computedMs) return a.computedMs > b.computedMs;
  return aId > bId;
}

function claimStanding(receipt: Receipt, claimId: Ulid): ClaimStanding {
  const { override, observationIds } = receipt;
  const before = override?.previousState ?? receipt.state;
  return {
    claimId,
    computedMs: instantMs(receipt.computedAt),
    asFinal: before === 'FINAL' ? observationIds : null,
    overrideMs: override === undefined ? null : instantMs(override.at),
    asOverridden: override?.grade === 'NOT_FOUND' ? [] : observationIds,
  };
}

/** The stored receipts read as a timeline of batch membership and pre-assignments. */
export class Timeline {
  readonly #claims = new Map<Ulid, { readonly standing: ClaimStanding; readonly receiptId: Ulid }>();
  readonly #taken: TakenStanding[] = [];

  constructor(receipts: readonly Receipt[]) {
    for (const receipt of receipts) {
      const { claimId, override } = receipt;
      if (claimId === undefined) {
        const [orphan] = receipt.observationIds;
        if (override === undefined || orphan === undefined) continue;
        const [computedMs, overrideMs] = [instantMs(receipt.computedAt), instantMs(override.at)];
        this.#taken.push({ observationId: orphan, computedMs, overrideMs });
        continue;
      }
      const standing = claimStanding(receipt, claimId);
      const held = this.#claims.get(claimId);
      if (held === undefined || later(standing, receipt.id, held.standing, held.receiptId)) {
        this.#claims.set(claimId, { standing, receiptId: receipt.id });
      }
    }
  }

  /**
   * The claims in the batch at `atMs`: first seen by then and graded at or after it, in claim id order. `seen`
   * finds a claim and its `observedAt` instant (undefined for a claim the snapshot lacks: it is in no batch).
   */
  batchClaims<C>(atMs: number, seen: (claimId: Ulid) => SeenClaim<C> | undefined): C[] {
    const found: { readonly id: Ulid; readonly claim: C }[] = [];
    for (const { standing } of this.#claims.values()) {
      const held = seen(standing.claimId);
      if (held === undefined || held.observedMs > atMs || atMs > standing.computedMs) continue;
      found.push({ id: standing.claimId, claim: held.claim });
    }
    return found.sort((a, b) => compareText(a.id, b.id)).map((one) => one.claim);
  }

  /** The fixed pairs and taken observations in force at `atMs`, in claim id and observation id order. */
  fixedAt(atMs: number): FixedAt {
    const fixed: FixedPair[] = [];
    for (const { standing } of this.#claims.values()) {
      if (atMs <= standing.computedMs) continue;
      const overridden = standing.overrideMs !== null && atMs >= standing.overrideMs;
      const held = overridden ? standing.asOverridden : (standing.asFinal ?? []);
      for (const observationId of held) fixed.push({ observationId, claimId: standing.claimId });
    }
    fixed.sort((a, b) => compareText(a.claimId, b.claimId) || compareText(a.observationId, b.observationId));
    const taken = new Set<Ulid>();
    for (const one of this.#taken) {
      if (atMs > one.computedMs && atMs >= one.overrideMs) taken.add(one.observationId);
    }
    return { fixed, taken };
  }
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
