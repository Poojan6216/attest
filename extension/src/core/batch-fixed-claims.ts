/**
 * The claim pre-assignments (docs/grading.md §4.3, §8): which observation each claim holds fixed, and in which
 * batches. Internal to batch-fixed.ts, which documents the rule; this module computes it.
 *
 * Each claim's latest receipt is read as spells in which it holds an observation, each in force in the batches
 * evaluated in `(begin, end]`:
 *  - FINAL evidence (`claimId` FINAL before any override): from its grading `computedAt`, broken by each override to
 *    NOT_FOUND (reverted ones from their `at` to their `revertedAt`, the one in force from its `at` for good); each
 *    spell after a break begins at that revert;
 *  - the evidence an override from PENDING to VERIFIED sat beside (each reverted one, and the one in force): from
 *    the later of its grading and the revert before it since that grading (until then the claim was held out by that
 *    earlier override, which may have fixed nothing), to its own revert (or for good).
 * A spell begins either at a grading (the batch at that instant assigned the observation, so it was free there) or
 * at a revert. Spells are then kept in the order they begin (gradings first at one instant, then claim id): a spell
 * that begins at a revert while another claim's kept spell holds the same observation is dropped, so a released
 * observation is never fixed again to a claim while another claim holds it, and one observation is never fixed to
 * two claims in one batch. A spell that begins at a grading is always kept: the batch assigned the observation
 * there, so no other claim held it; two that overlap mean a corrupt ledger, and `assign` refuses it
 * (`CandidatesError('fixed_conflict')`, Hard Rule 6). Every spell that begins at or before an instant is known to every
 * batch evaluated after it (the caller stamps events inside the transaction that writes them, §3), so whether a
 * spell is kept never changes once a batch could see it, and a batch and its replay keep the same ones (Hard Rule 4).
 *
 * Each kept spell becomes a pair whose `after` is the grading it records (batch.ts relies on it, `stale_evaluated_at`):
 * FINAL evidence one pair with `released` spans wherever it is not in force; the evidence of an override from PENDING
 * one pair per spell, with `until` at its revert and a `released` span from its grading to its begin when later.
 *
 * The pre-assignment types live here so batch-fixed.ts can re-export them without an import cycle.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { instantMs } from './normalize';
import { compareText } from './order';
import type { IsoTs, Receipt, Ulid } from './schema';

/** A span in which a pair is not in force: the batches evaluated after `from`, up to `to` inclusive or for good. */
export interface Release {
  readonly from: IsoTs;
  readonly to?: IsoTs;
}

/** One pre-assignment and the batches it is in force in (batch-fixed.ts documents the rule). */
export interface BatchFixed {
  readonly observationId: Ulid;
  /** The claim the observation is fixed to; null: taken (an overridden UNASKED receipt's orphan). */
  readonly claimId: Ulid | null;
  /** In force only in batches whose `evaluatedAt` is strictly after this instant (a claim pair: its grading). */
  readonly after: IsoTs;
  /** When present, in force only in batches whose `evaluatedAt` is at or before this instant (its revert). */
  readonly until?: IsoTs;
  /**
   * Not in force in the batches these spans hold: an override to NOT_FOUND released FINAL evidence there, an earlier
   * override held the claim there, or another claim held the observation when a revert would have fixed it again.
   */
  readonly released?: readonly Release[];
}

/** One spell (see the file comment): in force in the batches evaluated in `(begin, end]` (`end` absent: for good). */
interface Spell {
  readonly begin: IsoTs;
  readonly end?: IsoTs;
  /** Whether it begins at a grading (the batch assigned the observation there) rather than at a revert. */
  readonly graded: boolean;
}

/** One pair before the sweep: its claim, observation and grading, and the spells that may put it in force. */
interface Candidate {
  readonly claimId: Ulid;
  readonly observationId: Ulid;
  readonly after: IsoTs;
  readonly until?: IsoTs;
  readonly spells: readonly Spell[];
}

type Reverted = NonNullable<Receipt['reverted']>[number];

/** The spells of FINAL evidence graded at `computedAt` (see the file comment). */
function finalSpells(receipt: Receipt): Spell[] {
  const spells: Spell[] = [];
  let begin = receipt.computedAt;
  let graded = true;
  for (const entry of receipt.reverted ?? []) {
    if (entry.previousState !== 'FINAL' || entry.grade !== 'NOT_FOUND') continue;
    spells.push({ begin, end: entry.at, graded });
    [begin, graded] = [entry.revertedAt, false];
  }
  const { override } = receipt;
  spells.push(override?.grade === 'NOT_FOUND' ? { begin, end: override.at, graded } : { begin, graded });
  return spells;
}

/**
 * The revert of the override before `entries[index]` when it is later than that override's grading `computedAt`:
 * then the earlier override held the claim since that same grading (the schema refuses a regrade while an override
 * held it), and this one is in force only from that revert on.
 */
function revertBefore(entries: readonly Reverted[], index: number, computedAt: IsoTs): IsoTs | undefined {
  const before = entries[index - 1];
  if (before === undefined) return undefined;
  return instantMs(before.revertedAt) > instantMs(computedAt) ? before.revertedAt : undefined;
}

/** The pairs one claim receipt may fix before the sweep, in the order the receipt recorded them. */
function candidatesOf(receipt: Receipt, claimId: Ulid): Candidate[] {
  const found: Candidate[] = [];
  const entries = receipt.reverted ?? [];
  const pendingVerified = (computedAt: IsoTs, ids: readonly Ulid[], index: number, until?: IsoTs) => {
    const resumed = revertBefore(entries, index, computedAt);
    const begin = { begin: resumed ?? computedAt, graded: resumed === undefined };
    for (const observationId of ids) {
      // One spell object per observation: the sweep keeps or drops each observation's spells on their own.
      const spell: Spell = until === undefined ? { ...begin } : { ...begin, end: until };
      const bounds = until === undefined ? {} : { until };
      found.push({ claimId, observationId, after: computedAt, ...bounds, spells: [spell] });
    }
  };
  entries.forEach((entry, index) => {
    if (entry.previousState === 'PENDING' && entry.grade === 'VERIFIED') {
      pendingVerified(entry.computedAt, entry.observationIds, index, entry.revertedAt);
    }
  });
  const { override, observationIds, computedAt } = receipt;
  const before = override?.previousState ?? receipt.state;
  if (before === 'FINAL') {
    for (const observationId of observationIds) {
      found.push({ claimId, observationId, after: computedAt, spells: finalSpells(receipt) });
    }
  } else if (override?.grade === 'VERIFIED') {
    pendingVerified(computedAt, observationIds, entries.length);
  }
  return found;
}

/** A spell of one candidate, for the sweep. */
interface Placed {
  readonly candidate: number;
  readonly spell: Spell;
  readonly beginMs: number;
  readonly endMs: number;
}

/** Sweep order: begin instant, gradings first, claim id, then the order the receipts recorded them. */
function bySweepOrder(candidates: readonly Candidate[]) {
  return (a: Placed, b: Placed): number =>
    a.beginMs - b.beginMs ||
    Number(b.spell.graded) - Number(a.spell.graded) ||
    compareText(candidates[a.candidate]?.claimId ?? '', candidates[b.candidate]?.claimId ?? '') ||
    a.candidate - b.candidate;
}

/** The spells kept by the sweep (see the file comment), as a set of the placed spells. */
function keptSpells(candidates: readonly Candidate[]): Set<Spell> {
  const byObservation = new Map<Ulid, Placed[]>();
  candidates.forEach((candidate, index) => {
    for (const spell of candidate.spells) {
      const endMs = spell.end === undefined ? Number.POSITIVE_INFINITY : instantMs(spell.end);
      const placed = { candidate: index, spell, beginMs: instantMs(spell.begin), endMs };
      const held = byObservation.get(candidate.observationId);
      if (held === undefined) byObservation.set(candidate.observationId, [placed]);
      else held.push(placed);
    }
  });
  const kept = new Set<Spell>();
  for (const placed of byObservation.values()) {
    const holding: Placed[] = [];
    for (const one of placed.sort(bySweepOrder(candidates))) {
      const claimId = candidates[one.candidate]?.claimId;
      const taken = holding.some(
        (other) => candidates[other.candidate]?.claimId !== claimId && other.endMs > one.beginMs,
      );
      // A grading assigned the observation, so it was free there: never dropped. Two that overlap mean a corrupt
      // ledger, which `assign` refuses (`fixed_conflict`, Hard Rule 6) rather than this sweep choosing one.
      if (taken && !one.spell.graded) continue;
      holding.push(one);
      kept.add(one.spell);
    }
  }
  return kept;
}

/** Where `candidate` is not in force: before, between and after its kept spells (none kept: from `after` on). */
function releasedOf(candidate: Candidate, kept: ReadonlySet<Spell>): Release[] {
  const released: Release[] = [];
  let from: IsoTs | undefined = candidate.after;
  for (const spell of candidate.spells) {
    if (!kept.has(spell) || from === undefined) continue;
    if (instantMs(spell.begin) > instantMs(from)) released.push({ from, to: spell.begin });
    from = spell.end;
  }
  const bounded =
    candidate.until !== undefined && from !== undefined && instantMs(from) >= instantMs(candidate.until);
  if (from !== undefined && !bounded) released.push({ from });
  return released;
}

/**
 * The claim pairs of the latest claim receipts (`latest`, in claim id order), each claim's in the order its receipt
 * recorded them (reverted overrides from PENDING, then its current evidence). A pair none of whose spells is kept is
 * left out when it has ended (`until`); one that has not is kept, wholly released, so its claim stays named for
 * batch.ts (a claim with a pair that has not ended is never graded).
 */
export function claimPairs(latest: readonly (readonly [Ulid, Receipt])[]): BatchFixed[] {
  const candidates = latest.flatMap(([claimId, receipt]) => candidatesOf(receipt, claimId));
  const kept = keptSpells(candidates);
  const pairs: BatchFixed[] = [];
  for (const candidate of candidates) {
    const anyKept = candidate.spells.some((spell) => kept.has(spell));
    if (!anyKept && candidate.until !== undefined) continue;
    const { claimId, observationId, after, until } = candidate;
    const released = releasedOf(candidate, kept);
    pairs.push({
      observationId,
      claimId,
      after,
      ...(until === undefined ? {} : { until }),
      ...(released.length === 0 ? {} : { released }),
    });
  }
  return pairs;
}
